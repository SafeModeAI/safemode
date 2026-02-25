/**
 * Safe Mode Claude Code Plugin
 *
 * Provides Safe Mode integration for Claude Code CLI.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, unlinkSync, chmodSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';

// ============================================================================
// Types
// ============================================================================

export interface PluginStatus {
  installed: boolean;
  hooksInstalled: boolean;
  mcpPatched: boolean;
  version: string;
}

export interface InstallOptions {
  force?: boolean;
  preset?: string;
}

// ============================================================================
// Paths
// ============================================================================

const CLAUDE_DIR = join(homedir(), '.claude');
const HOOKS_DIR = join(CLAUDE_DIR, 'hooks');
const MCP_CONFIG_PATH = join(CLAUDE_DIR, 'mcp_servers.json');
const SAFEMODE_CONFIG_PATH = join(CLAUDE_DIR, 'safemode.json');

// ============================================================================
// Hook Scripts
// ============================================================================

const HOOK_SCRIPTS: Record<string, string> = {
  'pre-tool-call.js': `#!/usr/bin/env node
const input = JSON.parse(process.argv[2] || '{}');
// Pre-tool-call hook - runs before each tool call
// Customize this script to add your own logic
console.log(JSON.stringify({ continue: true }));
`,

  'post-tool-call.js': `#!/usr/bin/env node
const input = JSON.parse(process.argv[2] || '{}');
// Post-tool-call hook - runs after each tool call
// Customize this script to add your own logic
console.log(JSON.stringify({ continue: true }));
`,

  'session-start.js': `#!/usr/bin/env node
const input = JSON.parse(process.argv[2] || '{}');
console.error(\`[Safe Mode] Session started: \${input.sessionId}\`);
console.log(JSON.stringify({ continue: true }));
`,

  'session-end.js': `#!/usr/bin/env node
const input = JSON.parse(process.argv[2] || '{}');
const stats = input.stats || {};
console.error(\`[Safe Mode] Session ended. Tools: \${stats.toolCalls || 0}, Blocks: \${stats.blocks || 0}\`);
console.log(JSON.stringify({ continue: true }));
`,

  'on-error.js': `#!/usr/bin/env node
const input = JSON.parse(process.argv[2] || '{}');
console.error(\`[Safe Mode] Error: \${input.error?.message || 'Unknown'}\`);
console.log(JSON.stringify({ continue: true }));
`,
};

// ============================================================================
// Plugin Functions
// ============================================================================

/**
 * Check plugin installation status
 */
export function getStatus(): PluginStatus {
  const hooksInstalled = existsSync(HOOKS_DIR) &&
    Object.keys(HOOK_SCRIPTS).every(name => existsSync(join(HOOKS_DIR, name)));

  let mcpPatched = false;
  if (existsSync(MCP_CONFIG_PATH)) {
    try {
      const content = readFileSync(MCP_CONFIG_PATH, 'utf8');
      const config = JSON.parse(content);

      for (const server of Object.values(config.mcpServers || {})) {
        const s = server as { command?: string };
        if (s.command === 'safemode') {
          mcpPatched = true;
          break;
        }
      }
    } catch {
      // Ignore parse errors
    }
  }

  return {
    installed: hooksInstalled && mcpPatched,
    hooksInstalled,
    mcpPatched,
    version: '0.1.0',
  };
}

/**
 * Install Safe Mode hooks for Claude Code
 */
export async function install(options: InstallOptions = {}): Promise<void> {
  // Create .claude directory if needed
  if (!existsSync(CLAUDE_DIR)) {
    mkdirSync(CLAUDE_DIR, { recursive: true });
  }

  // Create hooks directory
  if (!existsSync(HOOKS_DIR)) {
    mkdirSync(HOOKS_DIR, { recursive: true });
  }

  // Install hook scripts
  for (const [name, content] of Object.entries(HOOK_SCRIPTS)) {
    const scriptPath = join(HOOKS_DIR, name);

    if (!existsSync(scriptPath) || options.force) {
      writeFileSync(scriptPath, content, 'utf8');

      // Make executable on Unix
      if (process.platform !== 'win32') {
        chmodSync(scriptPath, 0o755);
      }
    }
  }

  // Patch MCP config
  if (existsSync(MCP_CONFIG_PATH)) {
    patchMcpConfig(options.force);
  }

  // Write Safe Mode config for Claude Code
  const safemodeConfig = {
    version: '1.0',
    preset: options.preset || 'coding',
    installedAt: new Date().toISOString(),
  };

  writeFileSync(SAFEMODE_CONFIG_PATH, JSON.stringify(safemodeConfig, null, 2));
}

/**
 * Uninstall Safe Mode hooks from Claude Code
 */
export async function uninstall(): Promise<void> {
  // Remove hook scripts
  for (const name of Object.keys(HOOK_SCRIPTS)) {
    const scriptPath = join(HOOKS_DIR, name);

    if (existsSync(scriptPath)) {
      unlinkSync(scriptPath);
    }
  }

  // Restore MCP config if backup exists
  const backupPath = MCP_CONFIG_PATH + '.backup';

  if (existsSync(backupPath)) {
    copyFileSync(backupPath, MCP_CONFIG_PATH);
    unlinkSync(backupPath);
  }

  // Remove Safe Mode config
  if (existsSync(SAFEMODE_CONFIG_PATH)) {
    unlinkSync(SAFEMODE_CONFIG_PATH);
  }
}

/**
 * Patch MCP servers config to use safemode proxy
 */
function patchMcpConfig(force?: boolean): void {
  if (!existsSync(MCP_CONFIG_PATH)) {
    return;
  }

  const content = readFileSync(MCP_CONFIG_PATH, 'utf8');
  const config = JSON.parse(content);

  if (!config.mcpServers) {
    return;
  }

  let changed = false;

  for (const [name, server] of Object.entries(config.mcpServers)) {
    const serverConfig = server as { command?: string; args?: string[] };

    // Skip if already patched (unless force)
    if (serverConfig.command === 'safemode' && !force) {
      continue;
    }

    // Skip if already patched
    if (serverConfig.command === 'safemode') {
      continue;
    }

    // Create backup of original command
    const originalCommand = serverConfig.command;
    const originalArgs = serverConfig.args || [];

    // Patch to use safemode proxy
    serverConfig.command = 'safemode';
    serverConfig.args = ['proxy', '--', originalCommand!, ...originalArgs];

    changed = true;
  }

  if (changed) {
    // Backup original config
    const backupPath = MCP_CONFIG_PATH + '.backup';

    if (!existsSync(backupPath)) {
      copyFileSync(MCP_CONFIG_PATH, backupPath);
    }

    // Write patched config
    writeFileSync(MCP_CONFIG_PATH, JSON.stringify(config, null, 2));
  }
}

// ============================================================================
// CLI Entry Point
// ============================================================================

export async function main(args: string[]): Promise<void> {
  const command = args[0];

  switch (command) {
    case 'install':
      console.log('Installing Safe Mode for Claude Code...');
      await install({ preset: args[1] });
      console.log('Done!');
      break;

    case 'uninstall':
      console.log('Uninstalling Safe Mode from Claude Code...');
      await uninstall();
      console.log('Done!');
      break;

    case 'status':
      const status = getStatus();
      console.log('Safe Mode Claude Code Plugin Status:');
      console.log(`  Installed: ${status.installed ? 'Yes' : 'No'}`);
      console.log(`  Hooks: ${status.hooksInstalled ? 'Installed' : 'Not installed'}`);
      console.log(`  MCP Config: ${status.mcpPatched ? 'Patched' : 'Not patched'}`);
      console.log(`  Version: ${status.version}`);
      break;

    default:
      console.log('Safe Mode Claude Code Plugin');
      console.log('');
      console.log('Usage:');
      console.log('  safemode-claude-code install [preset]');
      console.log('  safemode-claude-code uninstall');
      console.log('  safemode-claude-code status');
  }
}

// Run if called directly
if (process.argv[1]?.endsWith('index.js') || process.argv[1]?.endsWith('index.ts')) {
  main(process.argv.slice(2)).catch(console.error);
}
