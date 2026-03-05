/**
 * Hook Runner
 *
 * Standalone governance pipeline for hook-based surfaces.
 * Reads tool call payload from stdin, runs CET → Knob → Engines,
 * outputs decision to stdout.
 *
 * Callable as: node hook-runner.js <surface>
 * Where surface is: claude-code | cursor | windsurf
 */

import { ConfigLoader } from '../config/index.js';
import { CETClassifier } from '../cet/index.js';
import { KnobGate } from '../knobs/gate.js';
import { EngineRegistry } from '../engines/index.js';
import { getRulesEngine, configureRulesEngine, parseRules } from '../rules/index.js';
import { getEventStore, closeEventStore } from '../store/index.js';
import { loadSessionOverrides } from '../config/allowlist.js';
import { nanoid } from 'nanoid';
import { createHash } from 'node:crypto';
import type { ToolCallEffect } from '../cet/types.js';
import type { SessionState, ToolCallSignature } from '../engines/base.js';

// ============================================================================
// Types
// ============================================================================

export type Surface = 'claude-code' | 'claude-code-post' | 'cursor' | 'cursor-post' | 'windsurf' | 'windsurf-post';

export interface HookInput {
  toolName: string;
  serverName?: string;
  parameters?: Record<string, unknown>;
  sessionId?: string;
  // Claude Code also passes effect, but we recompute via CET
  effect?: Record<string, unknown>;
}

interface PipelineState {
  config: Awaited<ReturnType<ConfigLoader['load']>>;
  cet: CETClassifier;
  knobGate: KnobGate;
  engines: EngineRegistry;
  initialized: boolean;
}

// ============================================================================
// Lazy-initialized pipeline state (cached across calls in same process)
// ============================================================================

let pipeline: PipelineState | null = null;

async function initPipeline(): Promise<PipelineState> {
  if (pipeline?.initialized) return pipeline;

  const configLoader = new ConfigLoader();
  const config = await configLoader.load();

  const cet = new CETClassifier();
  const knobGate = new KnobGate({
    knobs: config.knobs,
    approveFallback: config.approve_fallback,
  });
  const engines = new EngineRegistry({
    maxSessionCost: config.budget.max_session_cost,
    alertAt: config.budget.alert_at,
    failBehavior: 'closed',
  });

  // Load rules from config if present
  if (config.rules && config.rules.length > 0) {
    const rules = parseRules({ rules: config.rules });
    if (rules.length > 0) {
      configureRulesEngine(rules);
    }
  }

  pipeline = { config, cet, knobGate, engines, initialized: true };
  return pipeline;
}

// ============================================================================
// Session Management (SQLite-backed for cross-call state)
// ============================================================================

function getOrCreateSession(sessionId?: string): SessionState {
  const id = sessionId || `hook-${nanoid(8)}`;

  // Try to load from SQLite
  const store = getEventStore();
  const recentEvents = store.getRecentEvents(100);
  const sessionEvents = recentEvents.filter(e => e.session_id === id);

  // Reconstruct session state from events
  const signatures: ToolCallSignature[] = [];
  const callTimestamps: number[] = [];

  for (const event of sessionEvents) {
    if (event.tool_name) {
      const ts = event.timestamp ? new Date(event.timestamp).getTime() : Date.now();
      callTimestamps.push(ts);
      signatures.push({
        tool_name: event.tool_name,
        params_hash: '',
        timestamp: ts,
      });
    }
  }

  return {
    session_id: id,
    started_at: new Date(),
    tool_call_count: sessionEvents.length,
    session_cost_usd: 0,
    recent_signatures: signatures.slice(-100),
    error_counts: new Map(),
    call_counts: new Map(),
    latency_history: new Map(),
    call_timestamps: callTimestamps,
    calls_per_minute: [],
  };
}

// ============================================================================
// Core Pipeline
// ============================================================================

export async function runGovernancePipeline(
  input: HookInput,
  surface: Surface
): Promise<{ decision: 'allow' | 'block'; reason?: string }> {
  const startTime = performance.now();
  const { config, cet, knobGate, engines } = await initPipeline();

  const toolName = input.toolName || 'unknown';
  const serverName = input.serverName || 'unknown';
  const params = input.parameters || {};

  // 1. CET classification
  const effect = cet.classify(toolName, params);

  // 1b. Rules engine (enforced before knob gate per spec)
  try {
    const rulesEngine = getRulesEngine();
    const rulesResult = rulesEngine.evaluate({ toolName, serverName, parameters: params, effect });
    if (rulesResult.matched && rulesResult.finalAction === 'block') {
      const reason = rulesResult.matches[0]?.message || 'Blocked by rules engine';
      const latency = performance.now() - startTime;
      logEvent(input.sessionId, 'block', toolName, serverName, effect, latency, {
        rules_matched: rulesResult.matches.length,
        reason,
      });
      writeBlockNotification(toolName, reason, surface);
      return { decision: 'block', reason };
    }
  } catch {
    // Rules engine failure is non-fatal — continue pipeline
  }

  // 2. Knob gate evaluation (with session overrides from `safemode allow --once`)
  const sessionOverrides = loadSessionOverrides();
  const overrides = Object.keys(sessionOverrides).length > 0 ? sessionOverrides : undefined;
  const knobResult = knobGate.evaluate(effect, overrides);

  if (knobResult.decision === 'block') {
    const latency = performance.now() - startTime;
    logEvent(input.sessionId, 'block', toolName, serverName, effect, latency, {
      knob: knobResult.knob,
      reason: knobResult.reason,
    });
    writeBlockNotification(toolName, knobResult.reason, surface);
    return { decision: 'block', reason: knobResult.reason };
  }

  if (knobResult.decision === 'approve' && config.preset !== 'yolo') {
    const latency = performance.now() - startTime;
    const reason = 'Action requires approval (approve_fallback: block)';
    logEvent(input.sessionId, 'block', toolName, serverName, effect, latency, {
      knob: knobResult.knob,
      reason,
    });
    writeBlockNotification(toolName, reason, surface);
    return { decision: 'block', reason };
  }

  // 3. Run detection engines
  const session = getOrCreateSession(input.sessionId);
  const engineResult = await engines.evaluate(
    toolName,
    serverName,
    params,
    effect,
    session
  );

  // Update session tracking
  session.tool_call_count++;
  const paramsHash = createHash('sha256')
    .update(JSON.stringify(params))
    .digest('hex')
    .slice(0, 16);
  session.recent_signatures.push({
    tool_name: toolName,
    params_hash: paramsHash,
    timestamp: Date.now(),
  });
  session.call_timestamps.push(Date.now());

  if (engineResult.blocked) {
    const latency = performance.now() - startTime;
    logEvent(input.sessionId, 'block', toolName, serverName, effect, latency, {
      engine: engineResult.blocked_by,
      reason: engineResult.block_reason,
      engines_run: engineResult.engines_run,
      engines_triggered: engineResult.engines_triggered,
    });
    const reason = engineResult.block_reason || 'Blocked by detection engine';
    writeBlockNotification(toolName, reason, surface);
    return { decision: 'block', reason };
  }

  // 4. Allow
  const latency = performance.now() - startTime;
  logEvent(input.sessionId, 'allowed', toolName, serverName, effect, latency, {
    engines_run: engineResult.engines_run,
    engines_triggered: engineResult.engines_triggered,
  });

  return { decision: 'allow' };
}

// ============================================================================
// Event Logging
// ============================================================================

function logEvent(
  sessionId: string | undefined,
  outcome: string,
  toolName: string,
  serverName: string,
  effect: ToolCallEffect,
  latencyMs: number,
  details?: Record<string, unknown>
): void {
  try {
    const store = getEventStore();
    store.logEvent({
      session_id: sessionId || `hook-${nanoid(8)}`,
      event_type: 'tool_call',
      tool_name: toolName,
      server_name: serverName,
      risk_level: effect.risk,
      action_type: effect.action,
      target: effect.target,
      engines_run: details?.engines_run as number | undefined,
      engines_triggered: details?.engines_triggered as number | undefined,
      latency_ms: Math.round(latencyMs),
      outcome,
      details,
    });
  } catch {
    // Don't let logging failures break the hook
  }
}

// ============================================================================
// Block Notification (stderr)
// ============================================================================

function writeBlockNotification(toolName: string, reason: string, surface: Surface): void {
  const surfaceLabel = surface.replace(/-post$/, '');
  const lines = [
    '',
    '\u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557',
    '\u2551  Safe Mode                                       \u2551',
    `\u2551  Blocked: ${(toolName + ' \u2014 ' + reason).slice(0, 40).padEnd(40)} \u2551`,
    `\u2551  ${surfaceLabel.padEnd(14)} \u00b7 just now                        \u2551`,
    '\u2551                                                   \u2551',
    `\u2551  safemode allow <action> --once                   \u2551`,
    '\u255a\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255d',
    '',
  ];
  process.stderr.write(lines.join('\n'));
}

// ============================================================================
// Surface-Specific Output Formatting
// ============================================================================

function formatOutput(
  result: { decision: 'allow' | 'block'; reason?: string },
  surface: Surface
): string {
  // Claude Code PreToolUse: hookSpecificOutput with permissionDecision
  // Allow = exit 0 with no output; Block = deny with reason
  if (surface === 'claude-code') {
    if (result.decision === 'block') {
      return JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: result.reason || 'Blocked by Safe Mode',
        },
      });
    }
    return ''; // exit 0, no output = allow
  }

  // Claude Code PostToolUse: no blocking capability, just exit 0
  if (surface === 'claude-code-post') {
    return '';
  }

  // Cursor format: {"continue":true} or {"continue":false,"message":"..."}
  if (surface === 'cursor' || surface === 'cursor-post') {
    if (result.decision === 'block') {
      return JSON.stringify({
        continue: false,
        permission: 'deny',
        userMessage: `Blocked by Safe Mode: ${result.reason}`,
        agentMessage: 'This action violates the active governance policy',
      });
    }
    return JSON.stringify({ continue: true });
  }

  // Windsurf: exit code 2 for block (handled in main), stdout for metadata
  if (surface === 'windsurf' || surface === 'windsurf-post') {
    if (result.decision === 'block') {
      return JSON.stringify({ blocked: true, reason: result.reason });
    }
    return JSON.stringify({ blocked: false });
  }

  // Default: Claude Code format
  return JSON.stringify(result);
}

// ============================================================================
// Block Notification (phone/discord)
// ============================================================================

async function fireBlockNotification(toolName: string, reason: string): Promise<void> {
  try {
    const { config } = await initPipeline();
    const notifConfig = config.notifications;
    if (!notifConfig?.provider) return;

    const title = 'Safe Mode: Action Blocked';
    const body = `Tool: ${toolName}\nReason: ${reason}`;

    if (notifConfig.provider === 'telegram' && notifConfig.telegram) {
      const { TelegramApprovalProvider } = await import('../approvals/telegram.js');
      const provider = new TelegramApprovalProvider({
        botToken: notifConfig.telegram.bot_token,
        chatId: notifConfig.telegram.chat_id,
      });
      await provider.sendNotification(title, body);
    } else if (notifConfig.provider === 'discord' && notifConfig.discord) {
      const { DiscordApprovalProvider } = await import('../approvals/discord.js');
      const provider = new DiscordApprovalProvider({
        webhookUrl: notifConfig.discord.webhook_url,
      });
      await provider.sendNotification(title, body);
    }
  } catch {
    // Never let notification failures affect the hook
  }
}

// ============================================================================
// CLI Entry Point
// ============================================================================

async function main(): Promise<void> {
  const surface = (process.argv[2] || 'claude-code') as Surface;

  // Read input from stdin (Claude Code passes via env/stdin, Cursor via stdin)
  let inputData = '';

  // Check if stdin has data (non-TTY = piped input)
  if (!process.stdin.isTTY) {
    inputData = await new Promise<string>((resolve) => {
      const chunks: Buffer[] = [];
      let resolved = false;
      const done = (data: string) => { if (!resolved) { resolved = true; clearTimeout(timer); resolve(data); } };
      process.stdin.on('data', (chunk) => chunks.push(chunk));
      process.stdin.on('end', () => done(Buffer.concat(chunks).toString('utf8')));
      const timer = setTimeout(() => done(Buffer.concat(chunks).toString('utf8')), 2000);
    });
  }

  // If no stdin, check process.argv[3] (Claude Code passes context as arg)
  if (!inputData && process.argv[3]) {
    inputData = process.argv[3];
  }

  // Parse input
  let input: HookInput;
  try {
    const parsed = JSON.parse(inputData || '{}');
    input = {
      toolName: parsed.toolName || parsed.tool_name || 'unknown',
      serverName: parsed.serverName || parsed.server_name || 'unknown',
      parameters: parsed.parameters || parsed.tool_input || parsed.arguments || parsed.input || {},
      sessionId: parsed.sessionId || parsed.session_id,
    };
  } catch {
    // Fail open on parse error
    process.stdout.write(formatOutput({ decision: 'allow' }, surface) + '\n');
    return;
  }

  try {
    const result = await runGovernancePipeline(input, surface);
    process.stdout.write(formatOutput(result, surface) + '\n');

    // Fire-and-forget notification on block
    if (result.decision === 'block') {
      fireBlockNotification(input.toolName, result.reason || 'Unknown reason').catch(() => {});
    }

    // Windsurf uses exit code 2 to block
    if (surface.startsWith('windsurf') && result.decision === 'block') {
      process.exitCode = 2;
    }
  } catch (err) {
    // Fail open on any error
    process.stderr.write(`[Safe Mode] Hook error: ${(err as Error).message}\n`);
    process.stdout.write(formatOutput({ decision: 'allow' }, surface) + '\n');
  } finally {
    try { closeEventStore(); } catch { /* ignore */ }
  }
}

// Run if executed directly
const isDirectExecution = process.argv[1]?.includes('hook-runner');
if (isDirectExecution) {
  main().catch((err) => {
    process.stderr.write(`[Safe Mode] Fatal: ${(err as Error).message}\n`);
    // Fail open
    const surface = (process.argv[2] || 'claude-code') as Surface;
    process.stdout.write(formatOutput({ decision: 'allow' }, surface) + '\n');
    process.exitCode = 0;
  });
}
