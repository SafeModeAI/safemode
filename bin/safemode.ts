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

import { Command } from 'commander';
import { runProxy } from '../src/proxy/wrapper.js';
import { parseProxyArgs } from '../src/proxy/spawn.js';
import {
  initCommand,
  doctorCommand,
  restoreCommand,
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
} from '../src/cli/commands.js';
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
  .version('0.1.0');

// ============================================================================
// Init Command
// ============================================================================

program
  .command('init')
  .description('Initialize Safe Mode')
  .option('-p, --preset <preset>', 'Preset (yolo, coding, personal, trading, strict)', 'coding')
  .option('--ml', 'Enable ML engines (downloads ~85MB)')
  .option('-f, --force', 'Overwrite existing config')
  .action(async (options) => {
    await initCommand({
      preset: options.preset,
      mlEnabled: options.ml,
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
// Restore Command
// ============================================================================

program
  .command('restore')
  .description('Restore original MCP configurations')
  .action(async () => {
    await restoreCommand();
  });

// ============================================================================
// History Command
// ============================================================================

program
  .command('history')
  .description('View event history')
  .option('-l, --limit <number>', 'Number of events', '20')
  .option('-o, --outcome <outcome>', 'Filter by outcome (block, alert, allowed)')
  .action(async (options) => {
    await historyCommand({
      limit: parseInt(options.limit, 10),
      outcome: options.outcome,
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
// Parse and Run
// ============================================================================

program.parse();
