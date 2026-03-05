/**
 * CLI Commands
 *
 * Implements all Safe Mode CLI commands.
 */

import chalk from 'chalk';
import ora from 'ora';
import yaml from 'js-yaml';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { ConfigLoader, CONFIG_PATHS, type PresetName } from '../config/index.js';
import { getEventStore, closeEventStore } from '../store/index.js';
import { getNotificationManager } from '../notifications/index.js';
import { FirstRunScanner } from '../scanner/index.js';
import { getHookInstaller } from '../hooks/index.js';
import { getBridgeClient, isDeviceRegistered, getConnectionStatus, getBridgeHealth } from '../bridge/index.js';
import { ACTION_KNOB_MAP, VALID_ACTIONS, saveSessionOverride } from '../config/allowlist.js';

// ============================================================================
// Init Command
// ============================================================================

export async function initCommand(options: {
  preset?: string;
  mlEnabled?: boolean;
  skipScan?: boolean;
  force?: boolean;
}): Promise<void> {
  console.log(chalk.bold('\n  Safe Mode Initialization\n'));

  // 1. Detect MCP clients
  const detectSpinner = ora('Detecting MCP clients...').start();
  const clients = ConfigLoader.detectMCPClients();
  detectSpinner.stop();

  if (clients.length === 0) {
    console.log(chalk.yellow('  No MCP clients detected.'));
    console.log(chalk.gray('  Supported: Claude Desktop, Cursor, VS Code, Claude Code, Windsurf'));
    console.log();
  } else {
    console.log(chalk.green('  Found MCP clients:'));
    for (const client of clients) {
      console.log(`    • ${client.name}: ${client.servers} server(s)`);
      console.log(chalk.gray(`      ${client.path}`));
    }
    console.log();
  }

  // 2. Create directories (needed before scan)
  ConfigLoader.ensureDirectories();

  // 3. Run first-run scanner BEFORE preset selection (unless --skip-scan)
  if (!options.skipScan) {
  const scanSpinner = ora('Scanning project for security issues...').start();
  const scanner = new FirstRunScanner();
  const scanResults = await scanner.scan();
  scanSpinner.stop();

  if (scanResults.findings.length > 0) {
    const maxDisplay = 10;
    const displayed = scanResults.findings.slice(0, maxDisplay);
    const remaining = scanResults.findings.length - maxDisplay;

    // Box-formatted output for findings
    console.log();
    console.log('  \u250c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510');
    console.log(`  \u2502  ${chalk.yellow.bold('Safe Mode found issues in your setup')}        \u2502`);
    console.log('  \u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518');
    console.log();

    for (const finding of displayed) {
      const label = formatFindingType(finding.type);
      const location = finding.path ? chalk.gray(finding.path) : '';
      console.log(`    ${chalk.yellow(label.padEnd(22))} ${location}`);
    }

    if (remaining > 0) {
      console.log(chalk.gray(`    ... and ${remaining} more`));
    }

    console.log();
    console.log(chalk.bold('  Safe Mode will prevent these from leaving your machine.'));
  } else {
    console.log(chalk.green('  \u2713 Project scan complete \u2014 no exposed secrets found'));
    console.log(chalk.gray('    Safe Mode will keep it that way.'));
  }
  console.log();
  } // end !options.skipScan

  // 4. Select preset
  const preset = (options.preset as PresetName) || 'coding';
  console.log(chalk.bold(`  Preset: ${preset}`));
  console.log(chalk.gray(`    Run 'safemode init --preset <name>' to change`));
  console.log(chalk.gray('    Available: yolo, coding, personal, trading, strict'));
  console.log();

  // 5. Write default config if needed
  const configPath = CONFIG_PATHS.personalConfig;
  if (!fs.existsSync(configPath) || options.force) {
    ConfigLoader.writeDefaultConfig(preset);
    console.log(chalk.green(`  \u2713 Created config: ${configPath}`));
  } else {
    console.log(chalk.gray(`  Config exists: ${configPath}`));
  }

  // 6. Patch MCP configs if clients found
  if (clients.length > 0) {
    console.log();
    console.log(chalk.bold('  Patching MCP configurations...'));

    for (const client of clients) {
      try {
        const patched = patchMCPConfig(client.path);
        if (patched) {
          console.log(chalk.green(`  \u2713 Patched ${client.name}`));
        } else {
          console.log(chalk.gray(`  - ${client.name} (no changes needed)`));
        }
      } catch (error) {
        console.log(chalk.red(`  \u2717 Failed to patch ${client.name}: ${(error as Error).message}`));
      }
    }
  }

  // 7. Install IDE hooks (Claude Code, Cursor, Windsurf)
  console.log();
  console.log(chalk.bold('  Installing IDE hooks...'));
  const installer = getHookInstaller();
  const hookTargets: Array<{ name: string; method: () => Promise<void>; check: string }> = [
    { name: 'Claude Code', method: () => installer.installClaudeCode(), check: path.join(os.homedir(), '.claude') },
    { name: 'Cursor', method: () => installer.installCursor(), check: path.join(os.homedir(), '.cursor') },
    { name: 'Windsurf', method: () => installer.installWindsurf(), check: path.join(os.homedir(), '.codeium', 'windsurf') },
  ];

  for (const target of hookTargets) {
    if (fs.existsSync(target.check)) {
      try {
        await target.method();
        console.log(chalk.green(`  \u2713 ${target.name} hooks installed`));
      } catch (error) {
        console.log(chalk.yellow(`  ! ${target.name} hooks failed: ${(error as Error).message}`));
      }
    }
  }

  console.log();
  console.log(chalk.green.bold('  \u2713 Safe Mode initialized!'));
  console.log();
  console.log(chalk.gray('  Next steps:'));
  console.log('    1. Restart your MCP clients');
  console.log('    2. Run `safemode doctor` to verify installation');
  console.log('    3. Run `safemode activity` to monitor tool calls');
  console.log();
}

/**
 * Format finding type for display (never shows actual secret values)
 */
function formatFindingType(type: string): string {
  switch (type) {
    case 'secret': return 'Secret exposed';
    case 'env': return 'Env var exposed';
    case 'permission': return 'Permission issue';
    case 'config': return 'Config issue';
    default: return type;
  }
}

// ============================================================================
// Doctor Command
// ============================================================================

export async function doctorCommand(): Promise<void> {
  console.log(chalk.bold('\n🩺 Safe Mode Health Check\n'));

  let allGood = true;

  // Check config exists
  if (fs.existsSync(CONFIG_PATHS.personalConfig)) {
    console.log(chalk.green('  ✓ Config file exists'));
  } else {
    console.log(chalk.red('  ✗ Config file missing'));
    console.log(chalk.gray(`    Run 'safemode init' to create`));
    allGood = false;
  }

  // Check directories
  const dirs = [
    CONFIG_PATHS.eventsDir,
    CONFIG_PATHS.cacheDir,
    CONFIG_PATHS.pinsDir,
  ];

  for (const dir of dirs) {
    if (fs.existsSync(dir)) {
      console.log(chalk.green(`  ✓ Directory: ${path.basename(dir)}`));
    } else {
      console.log(chalk.yellow(`  - Directory missing: ${path.basename(dir)}`));
    }
  }

  // Check database
  try {
    const store = getEventStore();
    const summary = store.getSummary();
    console.log(chalk.green(`  ✓ Database: ${summary.total_events} events recorded`));
    closeEventStore();
  } catch (error) {
    console.log(chalk.red(`  ✗ Database error: ${(error as Error).message}`));
    allGood = false;
  }

  // Check MCP clients
  const clients = ConfigLoader.detectMCPClients();
  for (const client of clients) {
    const isPatched = checkMCPConfigPatched(client.path);
    if (isPatched) {
      console.log(chalk.green(`  ✓ ${client.name}: patched`));
    } else {
      console.log(chalk.yellow(`  - ${client.name}: not patched`));
      allGood = false;
    }
  }

  console.log();
  if (allGood) {
    console.log(chalk.green.bold('  All checks passed!'));
  } else {
    console.log(chalk.yellow.bold('  Some issues found. Run `safemode init` to fix.'));
  }
  console.log();
}

// ============================================================================
// Uninstall Command (formerly "restore" — restores MCP configs)
// ============================================================================

export async function uninstallCommand(): Promise<void> {
  console.log(chalk.bold('\n  Restoring original MCP configurations\n'));

  const clients = ConfigLoader.detectMCPClients();

  if (clients.length === 0) {
    console.log(chalk.gray('  No MCP clients found.'));
    return;
  }

  for (const client of clients) {
    try {
      const restored = restoreMCPConfig(client.path);
      if (restored) {
        console.log(chalk.green(`  \u2713 Restored ${client.name}`));
      } else {
        console.log(chalk.gray(`  - ${client.name} (not patched)`));
      }
    } catch (error) {
      console.log(chalk.red(`  \u2717 Failed to restore ${client.name}: ${(error as Error).message}`));
    }
  }

  console.log();
  console.log(chalk.green('  Done! Restart your MCP clients to apply changes.'));
  console.log();
}

// ============================================================================
// Restore Command (Time Machine)
// ============================================================================

export async function restoreCommand(options: {
  latest?: boolean;
  list?: boolean;
  session?: string;
  time?: string;
}): Promise<void> {
  const { getSnapshotStore } = await import('../timemachine/index.js');
  const store = getSnapshotStore();

  // List mode
  if (options.list) {
    console.log(chalk.bold('\n  Available Restore Points\n'));

    const sessions = store.getRecentSessions(20);
    if (sessions.length === 0) {
      console.log(chalk.gray('  No snapshots found.'));
      console.log(chalk.gray('  Snapshots are created when Safe Mode intercepts file modifications.'));
      console.log();
      store.close();
      return;
    }

    console.log(chalk.gray('  Session ID              Files   Snapshots   Time'));
    console.log(chalk.gray('  \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500'));

    for (const session of sessions) {
      const time = new Date(session.latestAt).toLocaleString();
      console.log(
        `  ${session.sessionId.padEnd(24)} ${String(session.fileCount).padEnd(8)} ${String(session.snapshotCount).padEnd(12)} ${time}`
      );
    }
    console.log();
    console.log(chalk.gray('  Use `safemode restore -s <session_id>` to restore a specific session'));
    console.log();
    store.close();
    return;
  }

  // Find session to restore
  let sessionId: string | undefined;

  if (options.session) {
    sessionId = options.session;
  } else if (options.time) {
    // Find closest session to the given time
    const targetTime = parseTimeArg(options.time);
    if (!targetTime) {
      console.log(chalk.red(`  Invalid time format: ${options.time}`));
      console.log(chalk.gray('  Use HH:MM format (e.g., 14:30)'));
      store.close();
      return;
    }
    const sessions = store.getRecentSessions(100);
    let closest: { sessionId: string; diff: number } | null = null;
    for (const s of sessions) {
      const sessionTime = new Date(s.latestAt).getTime();
      const diff = Math.abs(sessionTime - targetTime.getTime());
      if (!closest || diff < closest.diff) {
        closest = { sessionId: s.sessionId, diff };
      }
    }
    if (closest) {
      sessionId = closest.sessionId;
    }
  } else {
    // Default: most recent session
    const sessions = store.getRecentSessions(1);
    if (sessions.length > 0) {
      sessionId = sessions[0]!.sessionId;
    }
  }

  if (!sessionId) {
    console.log(chalk.gray('\n  No snapshots found to restore.\n'));
    store.close();
    return;
  }

  // Get summary before restoring
  const summary = store.getSessionSummary(sessionId);
  if (summary.totalSnapshots === 0) {
    console.log(chalk.yellow(`\n  No snapshots found for session: ${sessionId}\n`));
    store.close();
    return;
  }

  console.log(chalk.bold(`\n  Restoring session: ${sessionId}`));
  console.log(chalk.gray(`  ${summary.uniqueFiles} files, ${summary.rollbackableCount} rollbackable snapshots`));
  console.log();

  const spinner = ora('Restoring files...').start();
  const result = store.rollbackSession(sessionId);
  spinner.stop();

  if (result.restoredFiles.length > 0) {
    console.log(chalk.green(`  \u2713 Restored ${result.restoredFiles.length} file(s):`));
    for (const file of result.restoredFiles.slice(0, 10)) {
      console.log(chalk.gray(`    ${file}`));
    }
    if (result.restoredFiles.length > 10) {
      console.log(chalk.gray(`    ... and ${result.restoredFiles.length - 10} more`));
    }
  }

  if (result.failedFiles.length > 0) {
    console.log(chalk.red(`  \u2717 Failed to restore ${result.failedFiles.length} file(s):`));
    for (const f of result.failedFiles.slice(0, 5)) {
      console.log(chalk.gray(`    ${f.path}: ${f.error}`));
    }
  }

  console.log();
  store.close();
}

function parseTimeArg(timeStr: string): Date | null {
  const match = timeStr.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hours = parseInt(match[1]!, 10);
  const minutes = parseInt(match[2]!, 10);
  if (hours > 23 || minutes > 59) return null;
  const now = new Date();
  now.setHours(hours, minutes, 0, 0);
  return now;
}

// ============================================================================
// History Command
// ============================================================================

export async function historyCommand(options: {
  limit?: number;
  outcome?: string;
  json?: boolean;
}): Promise<void> {
  const store = getEventStore();
  const limit = options.limit || 20;

  let events;
  if (options.outcome) {
    events = store.getEventsByOutcome(options.outcome, limit);
  } else {
    events = store.getRecentEvents(limit);
  }

  if (options.json) {
    console.log(JSON.stringify(events, null, 2));
    closeEventStore();
    return;
  }

  if (events.length === 0) {
    console.log(chalk.gray('\n  No events found.\n'));
    return;
  }

  console.log(chalk.bold(`\n  Recent Events (${events.length})\n`));

  for (const event of events) {
    const icon = getOutcomeIcon(event.outcome);
    const risk = event.risk_level ? chalk.gray(`[${event.risk_level}]`) : '';
    const time = new Date(event.timestamp!).toLocaleTimeString();

    console.log(
      `  ${icon} ${chalk.gray(time)} ${event.tool_name || event.event_type} ${risk}`
    );

    if (event.details && (event.details as Record<string, unknown>).reason) {
      console.log(chalk.gray(`     ${(event.details as Record<string, unknown>).reason}`));
    }
  }

  console.log();
  closeEventStore();
}

// ============================================================================
// Summary Command
// ============================================================================

export async function summaryCommand(options: { since?: string }): Promise<void> {
  const store = getEventStore();

  let since: Date | undefined;
  if (options.since) {
    since = new Date(options.since);
  }

  const summary = store.getSummary(since);

  console.log(chalk.bold('\n  📊 Safe Mode Summary\n'));
  console.log(`  Total events:    ${summary.total_events}`);
  console.log(`  Blocked:         ${chalk.red(summary.total_blocks.toString())}`);
  console.log(`  Alerts:          ${chalk.yellow(summary.total_alerts.toString())}`);
  console.log(`  Allowed:         ${chalk.green(summary.total_allowed.toString())}`);
  console.log(`  Avg latency:     ${Math.round(summary.avg_latency_ms)}ms`);

  if (summary.top_blocked_tools.length > 0) {
    console.log();
    console.log(chalk.bold('  Top blocked tools:'));
    for (const tool of summary.top_blocked_tools.slice(0, 5)) {
      console.log(`    • ${tool.tool_name}: ${tool.count} blocks`);
    }
  }

  console.log();
  closeEventStore();
}

// ============================================================================
// Activity Command
// ============================================================================

export async function activityCommand(options: {
  limit?: number;
  severity?: string;
}): Promise<void> {
  const notifications = getNotificationManager();
  const limit = options.limit || 50;

  const entries = notifications.getRecentActivity(
    limit,
    options.severity as 'info' | 'low' | 'medium' | 'high' | 'critical' | undefined
  );

  if (entries.length === 0) {
    console.log(chalk.gray('\n  No activity found.\n'));
    return;
  }

  console.log(chalk.bold(`\n  Activity Feed (${entries.length} entries)\n`));

  for (const entry of entries) {
    const icon = getSeverityIcon(entry.severity);
    const time = new Date(entry.timestamp).toLocaleTimeString();

    console.log(`  ${icon} ${chalk.gray(time)} ${entry.message}`);
  }

  console.log();
}

// ============================================================================
// Helper Functions
// ============================================================================

function patchMCPConfig(configPath: string): boolean {
  const content = fs.readFileSync(configPath, 'utf8');
  const config = JSON.parse(content);

  if (!config.mcpServers) {
    return false;
  }

  let changed = false;

  for (const [_name, server] of Object.entries(config.mcpServers)) {
    const serverConfig = server as { command?: string; args?: string[] };

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
    // Backup original
    const backupPath = configPath + '.backup';
    if (!fs.existsSync(backupPath)) {
      fs.copyFileSync(configPath, backupPath);
    }

    // Write patched config
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  }

  return changed;
}

function restoreMCPConfig(configPath: string): boolean {
  const backupPath = configPath + '.backup';

  if (!fs.existsSync(backupPath)) {
    return false;
  }

  fs.copyFileSync(backupPath, configPath);
  fs.unlinkSync(backupPath);

  return true;
}

function checkMCPConfigPatched(configPath: string): boolean {
  try {
    const content = fs.readFileSync(configPath, 'utf8');
    const config = JSON.parse(content);

    if (!config.mcpServers) {
      return false;
    }

    for (const server of Object.values(config.mcpServers)) {
      const serverConfig = server as { command?: string };
      if (serverConfig.command === 'safemode') {
        return true;
      }
    }

    return false;
  } catch {
    return false;
  }
}

function getOutcomeIcon(outcome: string): string {
  switch (outcome) {
    case 'block':
      return chalk.red('✗');
    case 'alert':
      return chalk.yellow('⚠');
    case 'allowed':
      return chalk.green('✓');
    case 'quarantined':
      return chalk.red('🔒');
    default:
      return chalk.gray('•');
  }
}

function getSeverityIcon(severity: string): string {
  switch (severity) {
    case 'info':
      return chalk.gray('ℹ');
    case 'low':
      return chalk.blue('📝');
    case 'medium':
      return chalk.yellow('⚠');
    case 'high':
      return chalk.red('🔶');
    case 'critical':
      return chalk.red.bold('🚨');
    default:
      return chalk.gray('•');
  }
}

// ============================================================================
// Hook Check Command
// ============================================================================

export async function hookCheckCommand(options: {
  fix?: boolean;
}): Promise<void> {
  console.log(chalk.bold('\n🔌 Safe Mode Hook Status\n'));

  const installer = getHookInstaller();
  const installedIDEs = installer.getInstalledIDEs();

  if (installedIDEs.length === 0) {
    console.log(chalk.yellow('  No supported IDEs detected.'));
    console.log(chalk.gray('  Supported: Cursor, Claude Code, VS Code, Windsurf'));
    console.log();
    return;
  }

  let anyMissing = false;

  for (const ide of installedIDEs) {
    const status = await installer.verify(ide.ide);

    console.log(chalk.bold(`  ${ide.name}:`));
    console.log(chalk.gray(`    Path: ${status.path}`));

    if (status.installed) {
      console.log(chalk.green('    Status: ✓ Hooks installed'));
    } else {
      console.log(chalk.yellow('    Status: ⚠ Hooks not installed'));
      anyMissing = true;

      // Show which hooks are missing
      for (const hook of status.hooks) {
        if (!hook.exists) {
          console.log(chalk.gray(`      Missing: ${hook.name}`));
        } else if (!hook.executable) {
          console.log(chalk.gray(`      Not executable: ${hook.name}`));
        }
      }
    }

    console.log();
  }

  // Fix option
  if (options.fix && anyMissing) {
    console.log(chalk.bold('  Installing missing hooks...'));

    for (const ide of installedIDEs) {
      const status = await installer.verify(ide.ide);

      if (!status.installed) {
        try {
          await installer.install(ide.ide);
          console.log(chalk.green(`    ✓ Installed hooks for ${ide.name}`));
        } catch (error) {
          console.log(chalk.red(`    ✗ Failed to install for ${ide.name}: ${(error as Error).message}`));
        }
      }
    }

    console.log();
  } else if (anyMissing) {
    console.log(chalk.gray('  Run `safemode hook-check --fix` to install missing hooks.'));
    console.log();
  }
}

// ============================================================================
// Claude Code Command
// ============================================================================

export async function claudeCodeCommand(
  action: 'install' | 'uninstall' | 'status',
  _options: Record<string, unknown> = {}
): Promise<void> {
  const installer = getHookInstaller();

  switch (action) {
    case 'install': {
      console.log(chalk.bold('\n🔧 Installing Claude Code Integration\n'));

      const spinner = ora('Installing hooks...').start();

      try {
        await installer.installClaudeCode();
        spinner.succeed('Hooks installed');
      } catch (error) {
        spinner.fail(`Failed to install hooks: ${(error as Error).message}`);
        return;
      }

      // Patch MCP config if it exists
      const mcpConfigPath = path.join(os.homedir(), '.claude', 'mcp_servers.json');

      if (fs.existsSync(mcpConfigPath)) {
        const spinner2 = ora('Patching MCP configuration...').start();

        try {
          const patched = patchMCPConfig(mcpConfigPath);
          if (patched) {
            spinner2.succeed('MCP configuration patched');
          } else {
            spinner2.info('MCP configuration already patched');
          }
        } catch (error) {
          spinner2.fail(`Failed to patch MCP config: ${(error as Error).message}`);
        }
      }

      console.log();
      console.log(chalk.green.bold('  ✓ Claude Code integration installed!'));
      console.log();
      console.log(chalk.gray('  Restart Claude Code to apply changes.'));
      console.log();
      break;
    }

    case 'uninstall': {
      console.log(chalk.bold('\n🔧 Uninstalling Claude Code Integration\n'));

      const spinner = ora('Removing hooks...').start();

      try {
        await installer.uninstall('claude-code');
        spinner.succeed('Hooks removed');
      } catch (error) {
        spinner.fail(`Failed to remove hooks: ${(error as Error).message}`);
        return;
      }

      // Restore MCP config if backup exists
      const mcpConfigPath = path.join(os.homedir(), '.claude', 'mcp_servers.json');

      if (fs.existsSync(mcpConfigPath + '.backup')) {
        const spinner2 = ora('Restoring MCP configuration...').start();

        try {
          const restored = restoreMCPConfig(mcpConfigPath);
          if (restored) {
            spinner2.succeed('MCP configuration restored');
          } else {
            spinner2.info('No backup to restore');
          }
        } catch (error) {
          spinner2.fail(`Failed to restore MCP config: ${(error as Error).message}`);
        }
      }

      console.log();
      console.log(chalk.green.bold('  ✓ Claude Code integration removed!'));
      console.log();
      break;
    }

    case 'status': {
      console.log(chalk.bold('\n🔧 Claude Code Integration Status\n'));

      const status = await installer.verify('claude-code');

      console.log(`  Hooks directory: ${status.path}`);

      if (status.installed) {
        console.log(chalk.green('  Hooks: ✓ Installed'));
      } else {
        console.log(chalk.yellow('  Hooks: ⚠ Not installed'));

        for (const hook of status.hooks) {
          if (!hook.exists) {
            console.log(chalk.gray(`    Missing: ${hook.name}`));
          }
        }
      }

      // Check MCP config
      const mcpConfigPath = path.join(os.homedir(), '.claude', 'mcp_servers.json');

      if (fs.existsSync(mcpConfigPath)) {
        const isPatched = checkMCPConfigPatched(mcpConfigPath);
        if (isPatched) {
          console.log(chalk.green('  MCP Config: ✓ Patched'));
        } else {
          console.log(chalk.yellow('  MCP Config: ⚠ Not patched'));
        }
      } else {
        console.log(chalk.gray('  MCP Config: Not found'));
      }

      console.log();
      break;
    }

    default:
      console.log(chalk.red(`  Unknown action: ${action}`));
      console.log(chalk.gray('  Usage: safemode claude-code <install|uninstall|status>'));
  }
}

// ============================================================================
// Cursor Command
// ============================================================================

export async function cursorCommand(
  action: 'install' | 'uninstall' | 'status',
  _options: Record<string, unknown> = {}
): Promise<void> {
  const installer = getHookInstaller();

  switch (action) {
    case 'install': {
      console.log(chalk.bold('\n🔧 Installing Cursor Integration\n'));

      const spinner = ora('Installing hooks...').start();

      try {
        await installer.installCursor();
        spinner.succeed('Hooks installed');
      } catch (error) {
        spinner.fail(`Failed to install hooks: ${(error as Error).message}`);
        return;
      }

      // Patch MCP config if it exists
      const mcpConfigPath = path.join(os.homedir(), '.cursor', 'mcp.json');

      if (fs.existsSync(mcpConfigPath)) {
        const spinner2 = ora('Patching MCP configuration...').start();

        try {
          const patched = patchMCPConfig(mcpConfigPath);
          if (patched) {
            spinner2.succeed('MCP configuration patched');
          } else {
            spinner2.info('MCP configuration already patched');
          }
        } catch (error) {
          spinner2.fail(`Failed to patch MCP config: ${(error as Error).message}`);
        }
      }

      console.log();
      console.log(chalk.green.bold('  ✓ Cursor integration installed!'));
      console.log();
      console.log(chalk.gray('  Restart Cursor to apply changes.'));
      console.log();
      break;
    }

    case 'uninstall': {
      console.log(chalk.bold('\n🔧 Uninstalling Cursor Integration\n'));

      const spinner = ora('Removing hooks...').start();

      try {
        await installer.uninstall('cursor');
        spinner.succeed('Hooks removed');
      } catch (error) {
        spinner.fail(`Failed to remove hooks: ${(error as Error).message}`);
        return;
      }

      // Restore MCP config if backup exists
      const mcpConfigPath = path.join(os.homedir(), '.cursor', 'mcp.json');

      if (fs.existsSync(mcpConfigPath + '.backup')) {
        const spinner2 = ora('Restoring MCP configuration...').start();

        try {
          const restored = restoreMCPConfig(mcpConfigPath);
          if (restored) {
            spinner2.succeed('MCP configuration restored');
          } else {
            spinner2.info('No backup to restore');
          }
        } catch (error) {
          spinner2.fail(`Failed to restore MCP config: ${(error as Error).message}`);
        }
      }

      console.log();
      console.log(chalk.green.bold('  ✓ Cursor integration removed!'));
      console.log();
      break;
    }

    case 'status': {
      console.log(chalk.bold('\n🔧 Cursor Integration Status\n'));

      const status = await installer.verify('cursor');

      console.log(`  Hooks directory: ${status.path}`);

      if (status.installed) {
        console.log(chalk.green('  Hooks: ✓ Installed'));
      } else {
        console.log(chalk.yellow('  Hooks: ⚠ Not installed'));

        for (const hook of status.hooks) {
          if (!hook.exists) {
            console.log(chalk.gray(`    Missing: ${hook.name}`));
          }
        }
      }

      // Check MCP config
      const mcpConfigPath = path.join(os.homedir(), '.cursor', 'mcp.json');

      if (fs.existsSync(mcpConfigPath)) {
        const isPatched = checkMCPConfigPatched(mcpConfigPath);
        if (isPatched) {
          console.log(chalk.green('  MCP Config: ✓ Patched'));
        } else {
          console.log(chalk.yellow('  MCP Config: ⚠ Not patched'));
        }
      } else {
        console.log(chalk.gray('  MCP Config: Not found'));
      }

      console.log();
      break;
    }

    default:
      console.log(chalk.red(`  Unknown action: ${action}`));
      console.log(chalk.gray('  Usage: safemode cursor <install|uninstall|status>'));
  }
}

// ============================================================================
// Connect Command
// ============================================================================

export async function connectCommand(options: {
  apiKey?: string;
  apiUrl?: string;
}): Promise<void> {
  console.log(chalk.bold('\n☁️  TrustScope Cloud Connection\n'));

  const client = getBridgeClient({
    apiUrl: options.apiUrl || 'https://api.trustscope.ai',
  });

  // Check if already registered
  if (isDeviceRegistered() && !options.apiKey) {
    const status = getConnectionStatus();

    if (status.state === 'connected') {
      console.log(chalk.green('  ✓ Already connected'));
      const health = getBridgeHealth();
      console.log(chalk.gray(`    Last heartbeat: ${health.lastHeartbeat ? new Date(health.lastHeartbeat).toLocaleTimeString() : 'Never'}`));
      console.log(chalk.gray(`    Pending events: ${health.pendingEvents}`));
      console.log();
      return;
    }

    // Try to reconnect
    const spinner = ora('Reconnecting to TrustScope...').start();
    const result = await client.connect();

    if (result.success) {
      spinner.succeed('Connected to TrustScope');
      console.log(chalk.gray(`    Organization: ${result.orgId}`));
      console.log(chalk.gray(`    Tier: ${result.tier}`));
    } else {
      spinner.fail(`Connection failed: ${result.error}`);
      console.log(chalk.gray('    Run with --api-key to re-authenticate'));
    }

    console.log();
    return;
  }

  // Need API key for first connection
  if (!options.apiKey) {
    console.log(chalk.yellow('  API key required for first connection.'));
    console.log();
    console.log(chalk.gray('  Get your API key from:'));
    console.log(chalk.blue('    https://app.trustscope.ai/settings/api-keys'));
    console.log();
    console.log(chalk.gray('  Then run:'));
    console.log('    safemode connect --api-key smdev_your_api_key');
    console.log();
    return;
  }

  // Connect with API key
  const spinner = ora('Connecting to TrustScope...').start();
  const result = await client.connect(options.apiKey);

  if (result.success) {
    spinner.succeed('Connected to TrustScope');
    console.log();
    console.log(chalk.green('  ✓ Device registered'));
    console.log(chalk.gray(`    Organization: ${result.orgId}`));
    console.log(chalk.gray(`    Tier: ${result.tier}`));
    console.log();
    console.log(chalk.gray('  Your events will now sync to TrustScope cloud.'));
    console.log(chalk.gray('  View them at:'));
    console.log(chalk.blue('    https://app.trustscope.ai/activity'));
  } else {
    spinner.fail(`Connection failed: ${result.error}`);
  }

  console.log();
}

// ============================================================================
// Disconnect Command
// ============================================================================

export async function disconnectCommand(): Promise<void> {
  console.log(chalk.bold('\n☁️  TrustScope Cloud Disconnection\n'));

  const client = getBridgeClient();

  if (!isDeviceRegistered()) {
    console.log(chalk.gray('  Not connected to TrustScope.'));
    console.log();
    return;
  }

  // Flush pending events first
  const health = getBridgeHealth();
  if (health.pendingEvents > 0) {
    const spinner = ora(`Flushing ${health.pendingEvents} pending events...`).start();
    try {
      const result = await client.flush();
      spinner.succeed(`Flushed ${result.count} events`);
    } catch (error) {
      spinner.warn(`Could not flush events: ${(error as Error).message}`);
    }
  }

  // Disconnect
  client.clearAll();
  console.log(chalk.green('  ✓ Disconnected from TrustScope'));
  console.log(chalk.gray('    Device credentials cleared'));
  console.log();
}

// ============================================================================
// Sync Command
// ============================================================================

export async function syncCommand(options: {
  force?: boolean;
}): Promise<void> {
  console.log(chalk.bold('\n🔄 Sync Status\n'));

  const client = getBridgeClient();

  if (!isDeviceRegistered()) {
    console.log(chalk.yellow('  Not connected to TrustScope.'));
    console.log(chalk.gray('    Run `safemode connect --api-key <key>` first.'));
    console.log();
    return;
  }

  const stats = client.getSyncStats();

  console.log(`  Pending events:  ${stats.pending}`);
  console.log(`  Total synced:    ${chalk.green(stats.synced.toString())}`);
  console.log(`  Total failed:    ${chalk.red(stats.failed.toString())}`);
  console.log(`  Last sync:       ${stats.lastSync ? new Date(stats.lastSync).toLocaleString() : 'Never'}`);
  console.log();

  if (options.force || stats.pending > 0) {
    const spinner = ora(`Syncing ${stats.pending} events...`).start();
    try {
      const result = await client.syncNow();
      spinner.succeed(`Synced ${result.synced} events (${result.failed} failed)`);
    } catch (error) {
      spinner.fail(`Sync failed: ${(error as Error).message}`);
    }
    console.log();
  }
}

// ============================================================================
// Cloud Status Command
// ============================================================================

export async function cloudStatusCommand(): Promise<void> {
  console.log(chalk.bold('\n☁️  TrustScope Cloud Status\n'));

  if (!isDeviceRegistered()) {
    console.log(chalk.yellow('  Not connected to TrustScope.'));
    console.log(chalk.gray('    Run `safemode connect --api-key <key>` to connect.'));
    console.log();
    return;
  }

  const client = getBridgeClient();
  const health = getBridgeHealth();
  const status = getConnectionStatus();
  const syncStats = client.getSyncStats();

  // Connection status
  const stateIcon = health.healthy ? chalk.green('✓') : chalk.yellow('⚠');
  console.log(`  ${stateIcon} Connection: ${status.state}`);

  if (status.lastConnected) {
    console.log(chalk.gray(`    Last connected: ${new Date(status.lastConnected).toLocaleString()}`));
  }

  if (status.lastError) {
    console.log(chalk.red(`    Last error: ${status.lastError}`));
  }

  // Sync status
  console.log();
  console.log(chalk.bold('  Sync:'));
  console.log(`    Pending events:  ${syncStats.pending}`);
  console.log(`    Total synced:    ${syncStats.synced}`);
  console.log(`    Last sync:       ${syncStats.lastSync ? new Date(syncStats.lastSync).toLocaleString() : 'Never'}`);

  // Policy status
  console.log();
  console.log(chalk.bold('  Policies:'));
  const policyVersion = client.getPolicyVersion();
  const policies = client.getCachedPolicies();
  console.log(`    Version:   ${policyVersion || 'None'}`);
  console.log(`    Policies:  ${policies.length}`);

  // Health metrics
  console.log();
  console.log(chalk.bold('  Health:'));
  console.log(`    Avg latency:  ${health.avgLatencyMs}ms`);
  console.log(`    Error count:  ${health.errorCount}`);

  console.log();
}

// ============================================================================
// Version Command
// ============================================================================

export async function versionCommand(): Promise<void> {
  const pkgPath = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    '../../package.json'
  );
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    console.log(`safemode v${pkg.version}`);
  } catch {
    console.log('safemode v0.1.0');
  }
}

// ============================================================================
// Status Command
// ============================================================================

export async function statusCommand(): Promise<void> {
  console.log(chalk.bold('\n  Safe Mode Status\n'));

  // Active preset
  const configLoader = new ConfigLoader();
  let preset = 'unknown';
  try {
    const config = await configLoader.load();
    preset = config.preset;
  } catch {
    // Config not initialized
  }
  console.log(`  Preset:     ${chalk.bold(preset)}`);
  console.log();

  // Hook status per surface
  const installer = getHookInstaller();
  const installedIDEs = installer.getInstalledIDEs();

  console.log(chalk.bold('  Surface          Hook Status'));
  console.log(chalk.gray('  \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500'));

  if (installedIDEs.length === 0) {
    console.log(chalk.gray('  No supported IDEs detected'));
  } else {
    for (const ide of installedIDEs) {
      const status = await installer.verify(ide.ide);
      const icon = status.installed ? chalk.green('\u2713') : chalk.yellow('\u2717');
      const label = status.installed ? 'installed' : 'not installed';
      console.log(`  ${ide.name.padEnd(17)} ${icon} ${label}`);
    }
  }

  // Cloud connection
  console.log();
  if (isDeviceRegistered()) {
    const connStatus = getConnectionStatus();
    const icon = connStatus.state === 'connected' ? chalk.green('\u2713') : chalk.yellow('\u2717');
    console.log(`  Cloud:      ${icon} ${connStatus.state}`);
  } else {
    console.log(`  Cloud:      ${chalk.gray('not connected')}`);
  }

  console.log();
}

// ============================================================================
// Preset Command
// ============================================================================

const VALID_PRESETS: PresetName[] = ['yolo', 'coding', 'personal', 'trading', 'strict'];

export async function presetCommand(name: string): Promise<void> {
  if (!VALID_PRESETS.includes(name as PresetName)) {
    console.log(chalk.red(`  Invalid preset: ${name}`));
    console.log(chalk.gray(`  Available: ${VALID_PRESETS.join(', ')}`));
    return;
  }

  const configPath = CONFIG_PATHS.personalConfig;

  if (!fs.existsSync(configPath)) {
    console.log(chalk.yellow('  Config not found. Run `safemode init` first.'));
    return;
  }

  try {
    const content = fs.readFileSync(configPath, 'utf8');
    const config = yaml.load(content) as Record<string, unknown>;
    config.preset = name;
    fs.writeFileSync(configPath, yaml.dump(config));
    console.log(chalk.green(`  Preset switched to: ${name}`));
  } catch (error) {
    console.log(chalk.red(`  Failed to update config: ${(error as Error).message}`));
  }
}

// ============================================================================
// Allow Command (false positive escape hatch)
// ============================================================================

export async function allowCommand(
  action: string,
  options: { once?: boolean; always?: boolean }
): Promise<void> {
  const knobs = ACTION_KNOB_MAP[action];
  if (!knobs) {
    console.log(chalk.red(`  Invalid action: ${action}`));
    console.log(chalk.gray(`  Valid actions: ${VALID_ACTIONS.join(', ')}`));
    return;
  }
  const mode = options.always ? 'always' : 'once';

  if (mode === 'always') {
    // Write permanent override to config.yaml
    const configPath = CONFIG_PATHS.personalConfig;
    if (!fs.existsSync(configPath)) {
      console.log(chalk.yellow('  Config not found. Run `safemode init` first.'));
      return;
    }

    console.log(chalk.yellow.bold('  Warning: This permanently changes your config.'));
    console.log(chalk.gray(`  Knobs affected: ${knobs.join(', ')}`));

    try {
      const content = fs.readFileSync(configPath, 'utf8');
      const config = yaml.load(content) as Record<string, unknown>;

      // Add overrides section if missing
      if (!config.overrides || typeof config.overrides !== 'object') {
        config.overrides = {};
      }
      const overrides = config.overrides as Record<string, Record<string, string>>;

      // Set all related knobs to 'allow' under a flat overrides section
      if (!overrides.allowed) {
        overrides.allowed = {};
      }
      for (const knob of knobs) {
        overrides.allowed[knob] = 'allow';
      }

      fs.writeFileSync(configPath, yaml.dump(config));
      console.log(chalk.green(`  \u2713 Permanently allowed: ${action}`));
    } catch (error) {
      console.log(chalk.red(`  Failed to update config: ${(error as Error).message}`));
    }
  } else {
    // Write session override
    saveSessionOverride(action);
    console.log(chalk.green(`  \u2713 Allowed for this session: ${action}`));
    console.log(chalk.gray(`  Knobs affected: ${knobs.join(', ')}`));
    console.log(chalk.gray('  Override will be cleared on next `safemode init`'));
  }
}
