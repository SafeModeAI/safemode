/**
 * Hook Installer
 *
 * Installs and manages Safe Mode hooks for different IDEs.
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, chmodSync, unlinkSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

// Resolve path to the bundled hook-runner at install time
const __dirname_local = dirname(fileURLToPath(import.meta.url));
function getBundlePath(): string {
  // Compiled: __dirname_local = <pkg>/dist/src/hooks
  // Bundle:  <pkg>/dist/hooks/hook-runner.bundle.js
  // Walk up to dist/, then into hooks/
  const distDir = join(__dirname_local, '..', '..');  // dist/src/hooks -> dist/
  const bundlePath = join(distDir, 'hooks', 'hook-runner.bundle.js');
  if (existsSync(bundlePath)) return bundlePath;
  // Also check sibling (in case tsconfig outDir changes)
  const siblingPath = join(__dirname_local, 'hook-runner.bundle.js');
  if (existsSync(siblingPath)) return siblingPath;
  // Fallback: use safemode CLI (slower but always works)
  return '';
}

function getHookCommand(surface: string): string {
  const bundle = getBundlePath();
  if (bundle) {
    return `node ${bundle} ${surface}`;
  }
  // Fallback to CLI subcommand
  return `safemode hook ${surface}`;
}

import type {
  HookName,
  HookStatus,
  HookFileStatus,
  IDE,
  IDEInfo,
} from './types.js';

// ============================================================================
// Hook Scripts Content
// ============================================================================

const HOOK_SCRIPTS: Record<HookName, string> = {
  'pre-tool-call': `#!/usr/bin/env node
/**
 * Pre-Tool-Call Hook
 *
 * Executed before a tool call is forwarded to the MCP server.
 * Can block or modify the call.
 *
 * Input: { sessionId, toolName, serverName, parameters, effect }
 * Output: { continue: boolean, modified?: parameters, message?: string }
 */

const input = JSON.parse(process.argv[2] || '{}');

// Example: Block sudo commands
if (input.parameters?.command && typeof input.parameters.command === 'string') {
  if (input.parameters.command.includes('sudo ')) {
    console.log(JSON.stringify({
      continue: false,
      message: 'sudo commands blocked by pre-tool-call hook'
    }));
    process.exit(0);
  }
}

// Example: Sanitize paths
if (input.parameters?.path && typeof input.parameters.path === 'string') {
  // Remove any path traversal attempts
  const sanitized = input.parameters.path.replace(/\\.\\.\\/|\\.\\.\\\\/g, '');
  if (sanitized !== input.parameters.path) {
    console.log(JSON.stringify({
      continue: true,
      modified: { ...input.parameters, path: sanitized },
      message: 'Path sanitized by pre-tool-call hook'
    }));
    process.exit(0);
  }
}

// Continue normally
console.log(JSON.stringify({ continue: true }));
`,

  'post-tool-call': `#!/usr/bin/env node
/**
 * Post-Tool-Call Hook
 *
 * Executed after a tool call returns from the MCP server.
 * Can modify the response before it's returned to the client.
 *
 * Input: { sessionId, toolName, serverName, parameters, result, latencyMs }
 * Output: { continue: boolean, modified?: result, message?: string }
 */

const input = JSON.parse(process.argv[2] || '{}');

// Example: Redact sensitive patterns from output
function redactSensitive(text) {
  if (typeof text !== 'string') return text;

  // Redact AWS keys
  text = text.replace(/AKIA[0-9A-Z]{16}/g, 'AKIA[REDACTED]');

  // Redact credit card numbers (basic pattern)
  text = text.replace(/\\b\\d{4}[- ]?\\d{4}[- ]?\\d{4}[- ]?\\d{4}\\b/g, '[CARD REDACTED]');

  // Redact SSN
  text = text.replace(/\\b\\d{3}-\\d{2}-\\d{4}\\b/g, '[SSN REDACTED]');

  return text;
}

if (input.result && typeof input.result === 'object') {
  const result = input.result;

  // Handle text content
  if (result.content && typeof result.content === 'string') {
    const redacted = redactSensitive(result.content);
    if (redacted !== result.content) {
      console.log(JSON.stringify({
        continue: true,
        modified: { ...result, content: redacted },
        message: 'Sensitive data redacted from output'
      }));
      process.exit(0);
    }
  }

  // Handle array content
  if (Array.isArray(result.content)) {
    let modified = false;
    const newContent = result.content.map(item => {
      if (item.type === 'text' && typeof item.text === 'string') {
        const redacted = redactSensitive(item.text);
        if (redacted !== item.text) {
          modified = true;
          return { ...item, text: redacted };
        }
      }
      return item;
    });

    if (modified) {
      console.log(JSON.stringify({
        continue: true,
        modified: { ...result, content: newContent },
        message: 'Sensitive data redacted from output'
      }));
      process.exit(0);
    }
  }
}

// Continue normally
console.log(JSON.stringify({ continue: true }));
`,

  'schema-load': `#!/usr/bin/env node
/**
 * Schema-Load Hook
 *
 * Executed when tool schemas are loaded from an MCP server.
 * Can filter or modify tool definitions.
 *
 * Input: { sessionId, serverName, tools: ToolSchema[] }
 * Output: { continue: boolean, modified?: tools, message?: string }
 */

const input = JSON.parse(process.argv[2] || '{}');

// Example: Filter out dangerous-sounding tools
const dangerousPatterns = [
  /^delete_all/i,
  /^drop_/i,
  /^destroy_/i,
  /^nuke_/i,
];

if (Array.isArray(input.tools)) {
  const filtered = input.tools.filter(tool => {
    for (const pattern of dangerousPatterns) {
      if (pattern.test(tool.name)) {
        console.error(\`Filtering out dangerous tool: \${tool.name}\`);
        return false;
      }
    }
    return true;
  });

  if (filtered.length !== input.tools.length) {
    console.log(JSON.stringify({
      continue: true,
      modified: filtered,
      message: \`Filtered \${input.tools.length - filtered.length} dangerous tools\`
    }));
    process.exit(0);
  }
}

// Continue normally
console.log(JSON.stringify({ continue: true }));
`,

  'session-start': `#!/usr/bin/env node
/**
 * Session-Start Hook
 *
 * Executed when a new Safe Mode session starts.
 * Side effects only (logging, notifications).
 *
 * Input: { sessionId, timestamp, serverName }
 * Output: { continue: boolean, message?: string }
 */

const input = JSON.parse(process.argv[2] || '{}');

// Log session start
const timestamp = new Date(input.timestamp).toISOString();
console.error(\`[Safe Mode] Session \${input.sessionId} started at \${timestamp}\`);
console.error(\`[Safe Mode] Server: \${input.serverName}\`);

// Continue normally
console.log(JSON.stringify({ continue: true }));
`,

  'session-end': `#!/usr/bin/env node
/**
 * Session-End Hook
 *
 * Executed when a Safe Mode session ends.
 * Side effects only (reporting, cleanup).
 *
 * Input: { sessionId, timestamp, stats: { toolCalls, blocks, alerts, totalLatencyMs } }
 * Output: { continue: boolean, message?: string }
 */

const input = JSON.parse(process.argv[2] || '{}');

// Generate session summary
const stats = input.stats || {};
const duration = stats.totalLatencyMs ? \`\${(stats.totalLatencyMs / 1000).toFixed(2)}s\` : 'unknown';

console.error('');
console.error('[Safe Mode] Session Summary');
console.error('===========================');
console.error(\`Session ID: \${input.sessionId}\`);
console.error(\`Tool Calls: \${stats.toolCalls || 0}\`);
console.error(\`Blocked:    \${stats.blocks || 0}\`);
console.error(\`Alerts:     \${stats.alerts || 0}\`);
console.error(\`Duration:   \${duration}\`);
console.error('');

// Continue normally
console.log(JSON.stringify({ continue: true }));
`,

  'on-error': `#!/usr/bin/env node
/**
 * On-Error Hook
 *
 * Executed when an error occurs during Safe Mode processing.
 * Side effects only (logging, notifications).
 *
 * Input: { sessionId, error: { message, stack, code }, context: { toolName, serverName, phase } }
 * Output: { continue: boolean, message?: string }
 */

const input = JSON.parse(process.argv[2] || '{}');

// Log error details
console.error('');
console.error('[Safe Mode] Error Occurred');
console.error('==========================');
console.error(\`Session:  \${input.sessionId}\`);
console.error(\`Phase:    \${input.context?.phase || 'unknown'}\`);
console.error(\`Tool:     \${input.context?.toolName || 'N/A'}\`);
console.error(\`Server:   \${input.context?.serverName || 'N/A'}\`);
console.error(\`Error:    \${input.error?.message || 'Unknown error'}\`);

if (input.error?.stack) {
  console.error('');
  console.error('Stack trace:');
  console.error(input.error.stack);
}

console.error('');

// Continue normally (errors are already handled by Safe Mode)
console.log(JSON.stringify({ continue: true }));
`,

  'approval-request': `#!/usr/bin/env node
/**
 * Approval-Request Hook
 *
 * Executed when a tool call requires approval.
 * Can implement custom approval logic.
 *
 * Input: { sessionId, toolName, serverName, effect, reason, engineName }
 * Output: { continue: boolean, approved?: boolean, message?: string }
 */

const input = JSON.parse(process.argv[2] || '{}');

// Log approval request
console.error('');
console.error('[Safe Mode] Approval Required');
console.error('=============================');
console.error(\`Tool:     \${input.toolName}\`);
console.error(\`Server:   \${input.serverName}\`);
console.error(\`Risk:     \${input.effect?.risk || 'unknown'}\`);
console.error(\`Reason:   \${input.reason || 'No reason provided'}\`);
console.error(\`Engine:   \${input.engineName || 'N/A'}\`);
console.error('');

// By default, defer to Safe Mode's approval system
// Custom implementations could:
// - Prompt the user via terminal
// - Send a notification and wait
// - Check against an external policy server
// - Auto-approve based on custom rules

console.log(JSON.stringify({
  continue: true,
  // approved: true,  // Uncomment to auto-approve
  // approved: false, // Uncomment to auto-deny
}));
`,
};

// ============================================================================
// Platform-Native Hook Config Writers
// ============================================================================

/**
 * Write Claude Code settings.json with PreToolUse/PostToolUse hook entries.
 * Merges with existing settings — does not overwrite other fields.
 */
function writeClaudeCodeHookConfig(): void {
  const settingsPath = join(homedir(), '.claude', 'settings.json');
  const backupPath = settingsPath + '.safemode-backup';

  // Load existing settings or start fresh
  let settings: Record<string, unknown> = {};
  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
    } catch {
      settings = {};
    }
    // Back up original before first modification
    if (!existsSync(backupPath)) {
      copyFileSync(settingsPath, backupPath);
    }
  }

  // Build hook command — use bundled hook-runner for fast cold start
  const preCommand = getHookCommand('claude-code');
  const postCommand = getHookCommand('claude-code-post');

  // Merge hooks into settings (preserve existing hooks from other tools)
  const existingHooks = (settings.hooks || {}) as Record<string, unknown>;

  // Build PreToolUse array — add our hook, keep others
  const isSafemodeHook = (inner: Record<string, unknown>) =>
    typeof inner.command === 'string' && (inner.command.includes('hook-runner') || inner.command.includes('safemode hook'));

  const existingPre = (existingHooks.PreToolUse || []) as Array<Record<string, unknown>>;
  const filteredPre = existingPre.filter(
    (h) => !(h.hooks as Array<Record<string, unknown>>)?.some(isSafemodeHook)
  );
  filteredPre.push({
    matcher: '.*',
    hooks: [{ type: 'command', command: preCommand }],
  });

  // Build PostToolUse array
  const existingPost = (existingHooks.PostToolUse || []) as Array<Record<string, unknown>>;
  const filteredPost = existingPost.filter(
    (h) => !(h.hooks as Array<Record<string, unknown>>)?.some(isSafemodeHook)
  );
  filteredPost.push({
    matcher: '.*',
    hooks: [{ type: 'command', command: postCommand }],
  });

  settings.hooks = {
    ...existingHooks,
    PreToolUse: filteredPre,
    PostToolUse: filteredPost,
  };

  // Write with permission safety
  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
}

/**
 * Write Cursor hooks.json with beforeShellExecution, beforeMCPExecution, etc.
 */
function writeCursorHookConfig(): void {
  const hooksJsonPath = join(homedir(), '.cursor', 'hooks.json');
  const backupPath = hooksJsonPath + '.safemode-backup';

  // Load existing hooks.json or start fresh
  let hooksConfig: Record<string, unknown> = { version: 1, hooks: {} };
  if (existsSync(hooksJsonPath)) {
    try {
      hooksConfig = JSON.parse(readFileSync(hooksJsonPath, 'utf8'));
    } catch {
      hooksConfig = { version: 1, hooks: {} };
    }
    if (!existsSync(backupPath)) {
      copyFileSync(hooksJsonPath, backupPath);
    }
  }

  const preCommand = getHookCommand('cursor');
  const postCommand = getHookCommand('cursor-post');

  const hooks = (hooksConfig.hooks || {}) as Record<string, unknown>;

  // Helper: add safemode hook to an event, keeping existing non-safemode hooks
  function mergeHookArray(existing: unknown, command: string): Array<Record<string, unknown>> {
    const arr = Array.isArray(existing) ? existing : [];
    const filtered = arr.filter(
      (h: Record<string, unknown>) => typeof h.command !== 'string' ||
        (!h.command.toString().includes('hook-runner') && !h.command.toString().includes('safemode hook'))
    );
    filtered.push({ command, type: 'command' });
    return filtered;
  }

  hooks.beforeShellExecution = mergeHookArray(hooks.beforeShellExecution, preCommand);
  hooks.beforeMCPExecution = mergeHookArray(hooks.beforeMCPExecution, preCommand);
  hooks.beforeReadFile = mergeHookArray(hooks.beforeReadFile, preCommand);
  hooks.beforeSubmitPrompt = mergeHookArray(hooks.beforeSubmitPrompt, preCommand);
  hooks.afterFileEdit = mergeHookArray(hooks.afterFileEdit, postCommand);

  hooksConfig.version = 1;
  hooksConfig.hooks = hooks;

  mkdirSync(dirname(hooksJsonPath), { recursive: true });
  writeFileSync(hooksJsonPath, JSON.stringify(hooksConfig, null, 2), 'utf8');
}

/**
 * Write Windsurf hooks.json with pre_run_command, pre_write_code, etc.
 */
function writeWindsurfHookConfig(): void {
  const hooksJsonPath = join(homedir(), '.codeium', 'windsurf', 'hooks.json');
  const backupPath = hooksJsonPath + '.safemode-backup';

  let hooksConfig: Record<string, unknown> = { hooks: {} };
  if (existsSync(hooksJsonPath)) {
    try {
      hooksConfig = JSON.parse(readFileSync(hooksJsonPath, 'utf8'));
    } catch {
      hooksConfig = { hooks: {} };
    }
    if (!existsSync(backupPath)) {
      copyFileSync(hooksJsonPath, backupPath);
    }
  }

  const preCommand = getHookCommand('windsurf');
  const postCommand = getHookCommand('windsurf-post');

  const hooks = (hooksConfig.hooks || {}) as Record<string, unknown>;

  function mergeHookArray(existing: unknown, command: string): Array<Record<string, unknown>> {
    const arr = Array.isArray(existing) ? existing : [];
    const filtered = arr.filter(
      (h: Record<string, unknown>) => typeof h.command !== 'string' ||
        (!h.command.toString().includes('hook-runner') && !h.command.toString().includes('safemode hook'))
    );
    filtered.push({ command });
    return filtered;
  }

  hooks.pre_run_command = mergeHookArray(hooks.pre_run_command, preCommand);
  hooks.pre_write_code = mergeHookArray(hooks.pre_write_code, preCommand);
  hooks.pre_read_code = mergeHookArray(hooks.pre_read_code, preCommand);
  hooks.pre_mcp_tool_use = mergeHookArray(hooks.pre_mcp_tool_use, preCommand);
  hooks.post_run_command = mergeHookArray(hooks.post_run_command, postCommand);
  hooks.post_write_code = mergeHookArray(hooks.post_write_code, postCommand);
  hooks.post_mcp_tool_use = mergeHookArray(hooks.post_mcp_tool_use, postCommand);

  hooksConfig.hooks = hooks;

  mkdirSync(dirname(hooksJsonPath), { recursive: true });
  writeFileSync(hooksJsonPath, JSON.stringify(hooksConfig, null, 2), 'utf8');
}

/**
 * Remove Safe Mode hooks from Claude Code settings.json
 */
function removeClaudeCodeHookConfig(): void {
  const settingsPath = join(homedir(), '.claude', 'settings.json');
  const backupPath = settingsPath + '.safemode-backup';

  if (existsSync(backupPath)) {
    copyFileSync(backupPath, settingsPath);
    unlinkSync(backupPath);
    return;
  }

  // No backup — manually remove our hooks
  if (!existsSync(settingsPath)) return;
  try {
    const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
    const hooks = settings.hooks || {};
    for (const event of ['PreToolUse', 'PostToolUse']) {
      if (Array.isArray(hooks[event])) {
        hooks[event] = hooks[event].filter(
          (h: Record<string, unknown>) => !(h.hooks as Array<Record<string, unknown>>)?.some(
            (inner) => typeof inner.command === 'string' && inner.command.includes('hook-runner')
          )
        );
        if (hooks[event].length === 0) delete hooks[event];
      }
    }
    if (Object.keys(hooks).length === 0) delete settings.hooks;
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
  } catch { /* ignore */ }
}

/**
 * Remove Safe Mode hooks from Cursor hooks.json
 */
function removeCursorHookConfig(): void {
  const hooksJsonPath = join(homedir(), '.cursor', 'hooks.json');
  const backupPath = hooksJsonPath + '.safemode-backup';

  if (existsSync(backupPath)) {
    copyFileSync(backupPath, hooksJsonPath);
    unlinkSync(backupPath);
    return;
  }

  if (!existsSync(hooksJsonPath)) return;
  try {
    const config = JSON.parse(readFileSync(hooksJsonPath, 'utf8'));
    const hooks = config.hooks || {};
    for (const event of Object.keys(hooks)) {
      if (Array.isArray(hooks[event])) {
        hooks[event] = hooks[event].filter(
          (h: Record<string, unknown>) => typeof h.command !== 'string' || !h.command.includes('hook-runner')
        );
        if (hooks[event].length === 0) delete hooks[event];
      }
    }
    config.hooks = hooks;
    writeFileSync(hooksJsonPath, JSON.stringify(config, null, 2), 'utf8');
  } catch { /* ignore */ }
}

/**
 * Remove Safe Mode hooks from Windsurf hooks.json
 */
function removeWindsurfHookConfig(): void {
  const hooksJsonPath = join(homedir(), '.codeium', 'windsurf', 'hooks.json');
  const backupPath = hooksJsonPath + '.safemode-backup';

  if (existsSync(backupPath)) {
    copyFileSync(backupPath, hooksJsonPath);
    unlinkSync(backupPath);
    return;
  }

  if (!existsSync(hooksJsonPath)) return;
  try {
    const config = JSON.parse(readFileSync(hooksJsonPath, 'utf8'));
    const hooks = config.hooks || {};
    for (const event of Object.keys(hooks)) {
      if (Array.isArray(hooks[event])) {
        hooks[event] = hooks[event].filter(
          (h: Record<string, unknown>) => typeof h.command !== 'string' || !h.command.includes('hook-runner')
        );
        if (hooks[event].length === 0) delete hooks[event];
      }
    }
    config.hooks = hooks;
    writeFileSync(hooksJsonPath, JSON.stringify(config, null, 2), 'utf8');
  } catch { /* ignore */ }
}

// ============================================================================
// IDE Paths
// ============================================================================

function getIDEPaths(): Record<IDE, IDEInfo> {
  const home = homedir();

  return {
    cursor: {
      name: 'Cursor',
      ide: 'cursor',
      hooksPath: join(home, '.cursor', 'hooks'),
      configPath: join(home, '.cursor', 'mcp.json'),
      installed: existsSync(join(home, '.cursor')),
    },
    'claude-code': {
      name: 'Claude Code',
      ide: 'claude-code',
      hooksPath: join(home, '.claude', 'hooks'),
      configPath: join(home, '.claude', 'mcp_servers.json'),
      installed: existsSync(join(home, '.claude')),
    },
    vscode: {
      name: 'VS Code',
      ide: 'vscode',
      hooksPath: join(home, '.vscode', 'hooks'),
      configPath: join(home, '.vscode', 'mcp.json'),
      installed: existsSync(join(home, '.vscode')),
    },
    windsurf: {
      name: 'Windsurf',
      ide: 'windsurf',
      hooksPath: join(home, '.codeium', 'windsurf', 'hooks'),
      configPath: join(home, '.codeium', 'windsurf', 'hooks.json'),
      installed: existsSync(join(home, '.codeium', 'windsurf')) || existsSync(join(home, '.windsurf')),
    },
  };
}

// ============================================================================
// Hook Installer
// ============================================================================

export class HookInstaller {
  private idePaths: Record<IDE, IDEInfo>;

  constructor() {
    this.idePaths = getIDEPaths();
  }

  /**
   * Install hooks for Cursor — writes platform-native ~/.cursor/hooks.json
   */
  async installCursor(): Promise<void> {
    writeCursorHookConfig();
    await this.installLegacyScripts('cursor');
  }

  /**
   * Install hooks for Claude Code — writes platform-native ~/.claude/settings.json
   */
  async installClaudeCode(): Promise<void> {
    writeClaudeCodeHookConfig();
    await this.installLegacyScripts('claude-code');
  }

  /**
   * Install hooks for Windsurf — writes platform-native ~/.codeium/windsurf/hooks.json
   */
  async installWindsurf(): Promise<void> {
    writeWindsurfHookConfig();
    await this.installLegacyScripts('windsurf');
  }

  /**
   * Install hooks for VS Code (legacy scripts only, no native hook system)
   */
  async installVSCode(): Promise<void> {
    await this.installLegacyScripts('vscode');
  }

  /**
   * Install hooks for an IDE — dispatches to platform-specific method
   */
  async install(ide: IDE): Promise<void> {
    switch (ide) {
      case 'claude-code':
        return this.installClaudeCode();
      case 'cursor':
        return this.installCursor();
      case 'windsurf':
        return this.installWindsurf();
      case 'vscode':
        return this.installVSCode();
      default:
        throw new Error(`Unknown IDE: ${ide}`);
    }
  }

  /**
   * Install legacy hook scripts to an IDE's hooks directory
   */
  private async installLegacyScripts(ide: IDE): Promise<void> {
    const info = this.idePaths[ide];

    if (!info) {
      throw new Error(`Unknown IDE: ${ide}`);
    }

    // Create hooks directory
    if (!existsSync(info.hooksPath)) {
      mkdirSync(info.hooksPath, { recursive: true });
    }

    // Write each hook script
    const hookNames: HookName[] = [
      'pre-tool-call',
      'post-tool-call',
      'schema-load',
      'session-start',
      'session-end',
      'on-error',
      'approval-request',
    ];

    for (const hookName of hookNames) {
      const scriptPath = join(info.hooksPath, `${hookName}.js`);
      const content = HOOK_SCRIPTS[hookName];

      writeFileSync(scriptPath, content, 'utf8');

      // Make executable on Unix
      if (process.platform !== 'win32') {
        chmodSync(scriptPath, 0o755);
      }
    }
  }

  /**
   * Uninstall hooks for an IDE — removes platform-native config + legacy scripts
   */
  async uninstall(ide: IDE): Promise<void> {
    // Remove platform-native hook configs
    switch (ide) {
      case 'claude-code':
        removeClaudeCodeHookConfig();
        break;
      case 'cursor':
        removeCursorHookConfig();
        break;
      case 'windsurf':
        removeWindsurfHookConfig();
        break;
    }

    // Remove legacy hook scripts
    const info = this.idePaths[ide];

    if (!info) {
      throw new Error(`Unknown IDE: ${ide}`);
    }

    if (!existsSync(info.hooksPath)) {
      return;
    }

    const hookNames: HookName[] = [
      'pre-tool-call',
      'post-tool-call',
      'schema-load',
      'session-start',
      'session-end',
      'on-error',
      'approval-request',
    ];

    for (const hookName of hookNames) {
      const scriptPath = join(info.hooksPath, `${hookName}.js`);

      if (existsSync(scriptPath)) {
        unlinkSync(scriptPath);
      }
    }

    // Try to remove hooks directory if empty
    try {
      const remaining = readdirSync(info.hooksPath);
      if (remaining.length === 0) {
        unlinkSync(info.hooksPath);
      }
    } catch {
      // Ignore errors when removing directory
    }
  }

  /**
   * Verify hook installation for an IDE
   */
  async verify(ide: IDE): Promise<HookStatus> {
    const info = this.idePaths[ide];

    if (!info) {
      throw new Error(`Unknown IDE: ${ide}`);
    }

    const hooks: HookFileStatus[] = [];
    const hookNames: HookName[] = [
      'pre-tool-call',
      'post-tool-call',
      'schema-load',
      'session-start',
      'session-end',
      'on-error',
      'approval-request',
    ];

    for (const hookName of hookNames) {
      const scriptPath = join(info.hooksPath, `${hookName}.js`);
      const exists = existsSync(scriptPath);
      let executable = false;

      if (exists) {
        try {
          const stats = statSync(scriptPath);
          executable = (stats.mode & 0o111) !== 0 || process.platform === 'win32';
        } catch {
          executable = false;
        }
      }

      hooks.push({
        name: hookName,
        exists,
        executable,
        path: scriptPath,
      });
    }

    const installed = hooks.every(h => h.exists && h.executable);

    return {
      installed,
      path: info.hooksPath,
      hooks,
      ide,
    };
  }

  /**
   * Get installed IDEs
   */
  getInstalledIDEs(): IDEInfo[] {
    return Object.values(this.idePaths).filter(ide => ide.installed);
  }

  /**
   * Get all IDE info
   */
  getAllIDEs(): IDEInfo[] {
    return Object.values(this.idePaths);
  }

  /**
   * Check if Safe Mode hooks are installed in an IDE
   */
  async isInstalled(ide: IDE): Promise<boolean> {
    const status = await this.verify(ide);
    return status.installed;
  }
}

// ============================================================================
// Singleton
// ============================================================================

let _installer: HookInstaller | null = null;

export function getHookInstaller(): HookInstaller {
  if (!_installer) {
    _installer = new HookInstaller();
  }
  return _installer;
}
