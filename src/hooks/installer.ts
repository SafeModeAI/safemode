/**
 * Hook Installer
 *
 * Installs and manages Safe Mode hooks for different IDEs.
 */

import { existsSync, mkdirSync, writeFileSync, chmodSync, unlinkSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

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
      hooksPath: join(home, '.windsurf', 'hooks'),
      configPath: join(home, '.windsurf', 'mcp.json'),
      installed: existsSync(join(home, '.windsurf')),
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
   * Install hooks for Cursor
   */
  async installCursor(): Promise<void> {
    await this.install('cursor');
  }

  /**
   * Install hooks for Claude Code
   */
  async installClaudeCode(): Promise<void> {
    await this.install('claude-code');
  }

  /**
   * Install hooks for VS Code
   */
  async installVSCode(): Promise<void> {
    await this.install('vscode');
  }

  /**
   * Install hooks for an IDE
   */
  async install(ide: IDE): Promise<void> {
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
   * Uninstall hooks for an IDE
   */
  async uninstall(ide: IDE): Promise<void> {
    const info = this.idePaths[ide];

    if (!info) {
      throw new Error(`Unknown IDE: ${ide}`);
    }

    if (!existsSync(info.hooksPath)) {
      return; // Nothing to uninstall
    }

    // Remove each hook script
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
        // Directory is empty, remove it
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
