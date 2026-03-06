#!/usr/bin/env node
/**
 * Safe Mode CLI Entry Point
 *
 * Commands:
 *   init        Initialize Safe Mode
 *   proxy       Run as MCP proxy wrapper
 *   doctor      Health check
 *   restore     Restore original MCP configs
 *   history     View event history
 *   summary     View summary statistics
 *   activity    View activity feed
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { Command } from 'commander';
import { runProxy } from '../src/proxy/wrapper.js';
import { parseProxyArgs } from '../src/proxy/spawn.js';
import {
  initCommand,
  doctorCommand,
  restoreCommand,
  uninstallCommand,
  historyCommand,
  summaryCommand,
  activityCommand,
  hookCheckCommand,
  claudeCodeCommand,
  cursorCommand,
  connectCommand,
  disconnectCommand,
  syncCommand,
  cloudStatusCommand,
  versionCommand,
  statusCommand,
  presetCommand,
  allowCommand,
} from '../src/cli/commands.js';
import { phoneCommand } from '../src/cli/phone.js';
import { ConfigLoader } from '../src/config/index.js';
import { getEventStore } from '../src/store/index.js';
import { CETClassifier } from '../src/cet/index.js';
import { ATSPEngine, createATSPConfig } from '../src/atsp/index.js';
import { KnobGate } from '../src/knobs/gate.js';
import { EngineRegistry } from '../src/engines/index.js';
import { SchemaQuarantine } from '../src/quarantine/schema.js';
import { OutputQuarantine } from '../src/quarantine/output.js';
import { TOFUManager } from '../src/tofu/index.js';
import { getNotificationManager } from '../src/notifications/index.js';

const program = new Command();

program
  .name('safemode')
  .description('AI governance for MCP servers')
  .version(
    JSON.parse(
      fs.readFileSync(path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../package.json'), 'utf8')
    ).version
  );

// ============================================================================
// Init Command
// ============================================================================

program
  .command('init')
  .description('Initialize Safe Mode')
  .option('-p, --preset <preset>', 'Preset (yolo, coding, personal, trading, strict)', 'coding')
  .option('--ml', 'Enable ML engines (downloads ~85MB, opt-in)')
  .option('--skip-scan', 'Skip first-run project scan')
  .option('-f, --force', 'Overwrite existing config')
  .action(async (options) => {
    await initCommand({
      preset: options.preset,
      mlEnabled: options.ml,
      skipScan: options.skipScan,
      force: options.force,
    });
  });

// ============================================================================
// Proxy Command
// ============================================================================

program
  .command('proxy')
  .description('Run as MCP proxy wrapper')
  .option('--preset <preset>', 'Override preset')
  .allowUnknownOption()
  .action(async (options, _command) => {
    // Parse arguments after --
    const dashIndex = process.argv.indexOf('--');

    if (dashIndex === -1) {
      console.error('Usage: safemode proxy [--preset <preset>] -- <command> [args...]');
      process.exit(1);
    }

    const serverArgs = process.argv.slice(dashIndex + 1);
    if (serverArgs.length === 0) {
      console.error('Error: No server command specified');
      process.exit(1);
    }

    const spawnOptions = parseProxyArgs(serverArgs);
    if (!spawnOptions) {
      console.error('Error: Failed to parse server command');
      process.exit(1);
    }

    // Load configuration
    const configLoader = new ConfigLoader();
    const config = await configLoader.load();
    const preset = options.preset || config.preset;

    // Initialize dependencies
    const store = getEventStore();
    const cet = new CETClassifier();
    const atspConfig = createATSPConfig(preset, config.knobs);
    const atsp = new ATSPEngine(atspConfig);
    const knobGate = new KnobGate({
      knobs: config.knobs,
      approveFallback: config.approve_fallback,
    });
    const engines = new EngineRegistry({
      maxSessionCost: config.budget.max_session_cost,
      alertAt: config.budget.alert_at,
      failBehavior: 'closed',
    });
    const schemaQuarantine = new SchemaQuarantine(store);
    const outputQuarantine = new OutputQuarantine(store);
    const tofu = new TOFUManager(store);
    const notifications = getNotificationManager();

    // Create dependencies object
    const deps = {
      schemaQuarantine: {
        scan: (tools: any) => schemaQuarantine.scan(tools),
      },
      atsp: {
        rewrite: (tools: any) => atsp.rewrite(tools),
      },
      tofu: {
        pin: (serverName: string, tools: any) => tofu.pin(serverName, tools),
      },
      cet: {
        classify: (toolName: string, params: any) => cet.classify(toolName, params),
      },
      knobGate: {
        evaluate: (effect: any) => knobGate.evaluate(effect),
      },
      engines: {
        evaluate: (toolName: string, serverName: string, params: any, effect: any, session: any) =>
          engines.evaluate(toolName, serverName, params, effect, session),
      },
      outputQuarantine: {
        scan: (response: any) => outputQuarantine.scan(response),
      },
      eventStore: {
        logEvent: (event: any) => store.logEvent(event),
      },
      notifications: {
        notify: (severity: string, message: string) =>
          notifications.notify(severity as any, message),
      },
    };

    // Run proxy
    try {
      await runProxy(spawnOptions, preset, deps);
    } catch (error) {
      console.error(`Proxy error: ${(error as Error).message}`);
      process.exit(1);
    }
  });

// ============================================================================
// Doctor Command
// ============================================================================

program
  .command('doctor')
  .description('Health check')
  .action(async () => {
    await doctorCommand();
  });

// ============================================================================
// Restore Command (Time Machine)
// ============================================================================

program
  .command('restore [timestamp]')
  .description('Restore files from Time Machine snapshots')
  .option('--latest', 'Restore most recent session (default)')
  .option('--list', 'List available restore points')
  .option('-s, --session <id>', 'Restore a specific session')
  .option('-t, --time <HH:MM>', 'Find closest session to timestamp')
  .action(async (timestamp, options) => {
    await restoreCommand({
      latest: options.latest,
      list: options.list,
      session: options.session,
      time: options.time || timestamp,
    });
  });

// ============================================================================
// Uninstall Command
// ============================================================================

program
  .command('uninstall')
  .description('Restore original MCP configurations and remove hooks')
  .action(async () => {
    await uninstallCommand();
  });

// ============================================================================
// History Command
// ============================================================================

program
  .command('history')
  .description('View event history')
  .option('-l, --limit <number>', 'Number of events', '20')
  .option('-o, --outcome <outcome>', 'Filter by outcome (block, alert, allowed)')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    await historyCommand({
      limit: parseInt(options.limit, 10),
      outcome: options.outcome,
      json: options.json,
    });
  });

// ============================================================================
// Summary Command
// ============================================================================

program
  .command('summary')
  .description('View summary statistics')
  .option('-s, --since <date>', 'Start date (ISO format)')
  .action(async (options) => {
    await summaryCommand({ since: options.since });
  });

// ============================================================================
// Activity Command
// ============================================================================

program
  .command('activity')
  .description('View activity feed')
  .option('-l, --limit <number>', 'Number of entries', '50')
  .option('-s, --severity <level>', 'Minimum severity (info, low, medium, high, critical)')
  .action(async (options) => {
    await activityCommand({
      limit: parseInt(options.limit, 10),
      severity: options.severity,
    });
  });

// ============================================================================
// Hook Check Command
// ============================================================================

program
  .command('hook-check')
  .description('Check IDE hook installation status')
  .option('--fix', 'Install missing hooks')
  .action(async (options) => {
    await hookCheckCommand({ fix: options.fix });
  });

// ============================================================================
// Claude Code Command
// ============================================================================

program
  .command('claude-code <action>')
  .description('Manage Claude Code integration (install|uninstall|status)')
  .action(async (action) => {
    await claudeCodeCommand(action);
  });

// ============================================================================
// Cursor Command
// ============================================================================

program
  .command('cursor <action>')
  .description('Manage Cursor integration (install|uninstall|status)')
  .action(async (action) => {
    await cursorCommand(action);
  });

// ============================================================================
// Connect Command
// ============================================================================

program
  .command('connect')
  .description('Connect to TrustScope cloud')
  .option('-k, --api-key <key>', 'API key (smdev_ or ts_ prefix)')
  .option('-u, --api-url <url>', 'API URL (default: https://api.trustscope.ai)')
  .action(async (options) => {
    await connectCommand({
      apiKey: options.apiKey,
      apiUrl: options.apiUrl,
    });
  });

// ============================================================================
// Disconnect Command
// ============================================================================

program
  .command('disconnect')
  .description('Disconnect from TrustScope cloud')
  .action(async () => {
    await disconnectCommand();
  });

// ============================================================================
// Sync Command
// ============================================================================

program
  .command('sync')
  .description('View and trigger event sync')
  .option('-f, --force', 'Force sync even if no pending events')
  .action(async (options) => {
    await syncCommand({ force: options.force });
  });

// ============================================================================
// Cloud Status Command
// ============================================================================

program
  .command('cloud-status')
  .description('View TrustScope cloud connection status')
  .action(async () => {
    await cloudStatusCommand();
  });

// ============================================================================
// Version Command (explicit, beyond commander's --version)
// ============================================================================

program
  .command('version')
  .description('Show Safe Mode version')
  .action(async () => {
    await versionCommand();
  });

// ============================================================================
// Status Command
// ============================================================================

program
  .command('status')
  .description('Show Safe Mode status (hooks, preset, cloud)')
  .action(async () => {
    await statusCommand();
  });

// ============================================================================
// Preset Command
// ============================================================================

program
  .command('preset <name>')
  .description('Switch active preset (yolo, coding, personal, trading, strict)')
  .action(async (name) => {
    await presetCommand(name);
  });

// ============================================================================
// Allow Command
// ============================================================================

program
  .command('allow <action>')
  .description('Allow a blocked action (secrets, pii, delete, write, git, network, packages, commands)')
  .option('--once', 'Allow for this session only (default)')
  .option('--always', 'Permanently allow in config')
  .action(async (action, options) => {
    await allowCommand(action, { once: options.once, always: options.always });
  });

// ============================================================================
// Phone Command
// ============================================================================

program
  .command('phone')
  .description('Configure phone notifications (Telegram/Discord)')
  .option('--telegram', 'Set up Telegram notifications')
  .option('--discord', 'Set up Discord notifications')
  .option('--test', 'Test current notification setup')
  .option('--disable', 'Disable notifications')
  .action(async (options) => {
    await phoneCommand({
      telegram: options.telegram,
      discord: options.discord,
      test: options.test,
      disable: options.disable,
    });
  });

// ============================================================================
// Hook Command (invoked by platform hooks: safemode hook pre/post/cursor-pre/cursor-post)
// ============================================================================

import { runGovernancePipeline, type Surface, type HookInput } from '../src/hooks/hook-runner.js';
import { closeEventStore } from '../src/store/index.js';

const hookCmd = program
  .command('hook')
  .description('Run governance hook (called by platform hook configs)');

async function runHook(surface: Surface): Promise<void> {
  // Read input from stdin
  let inputData = '';
  if (!process.stdin.isTTY) {
    inputData = await new Promise<string>((resolve) => {
      const chunks: Buffer[] = [];
      let resolved = false;
      const done = (data: string) => { if (!resolved) { resolved = true; clearTimeout(timer); resolve(data); } };
      process.stdin.on('data', (chunk: Buffer) => chunks.push(chunk));
      process.stdin.on('end', () => done(Buffer.concat(chunks).toString('utf8')));
      const timer = setTimeout(() => done(Buffer.concat(chunks).toString('utf8')), 2000);
    });
  }

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
    // Fail open on parse error — exit 0, no output
    return;
  }

  try {
    const result = await runGovernancePipeline(input, surface);

    // Format output per surface
    if (surface === 'claude-code') {
      // Claude Code PreToolUse: hookSpecificOutput with permissionDecision
      if (result.decision === 'block') {
        process.stdout.write(JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason: result.reason || 'Blocked by Safe Mode',
          },
        }) + '\n');
      } else {
        process.stdout.write(JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'allow',
          },
        }) + '\n');
      }
    } else if (surface === 'claude-code-post') {
      // PostToolUse: no blocking capability, just exit 0
    } else if (surface.startsWith('cursor')) {
      if (result.decision === 'block') {
        process.stdout.write(JSON.stringify({
          continue: false,
          permission: 'deny',
          userMessage: `Blocked by Safe Mode: ${result.reason}`,
          agentMessage: 'This action violates the active governance policy',
        }) + '\n');
      } else {
        process.stdout.write(JSON.stringify({ continue: true }) + '\n');
      }
    } else if (surface.startsWith('windsurf')) {
      if (result.decision === 'block') {
        process.stdout.write(JSON.stringify({ blocked: true, reason: result.reason }) + '\n');
        process.exitCode = 2;
      }
    }
  } catch (err) {
    process.stderr.write(`[Safe Mode] Hook error: ${(err as Error).message}\n`);
    // Fail open — exit 0, no output
  } finally {
    try { closeEventStore(); } catch { /* ignore */ }
  }
}

hookCmd.command('pre').description('Pre-tool-use hook (Claude Code)').action(() => runHook('claude-code'));
hookCmd.command('post').description('Post-tool-use hook (Claude Code)').action(() => runHook('claude-code-post'));
hookCmd.command('cursor-pre').description('Pre-tool-use hook (Cursor)').action(() => runHook('cursor'));
hookCmd.command('cursor-post').description('Post-tool-use hook (Cursor)').action(() => runHook('cursor-post'));
hookCmd.command('windsurf-pre').description('Pre-tool-use hook (Windsurf)').action(() => runHook('windsurf'));
hookCmd.command('windsurf-post').description('Post-tool-use hook (Windsurf)').action(() => runHook('windsurf-post'));

// ============================================================================
// Parse and Run
// ============================================================================

program.parse();
