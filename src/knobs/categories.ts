/**
 * Knob Categories and Definitions
 *
 * 19 categories with ~100 knobs total.
 * Each knob has 3 possible values: allow | approve | block
 */

// ============================================================================
// Knob Types
// ============================================================================

export type KnobValue = 'allow' | 'approve' | 'block';

/**
 * Knob definition with metadata
 */
export interface KnobDefinition {
  /** Knob identifier (e.g., "file_write") */
  id: string;

  /** Human-readable name */
  name: string;

  /** Description of what this knob controls */
  description: string;

  /** Default value if not configured */
  default: KnobValue;

  /** Whether this knob can be overridden (false = hardcoded) */
  overridable: boolean;

  /** Category this knob belongs to */
  category: KnobCategory;
}

export type KnobCategory =
  | 'terminal'
  | 'filesystem'
  | 'git'
  | 'network'
  | 'database'
  | 'financial'
  | 'api'
  | 'communication'
  | 'cloud'
  | 'container'
  | 'package'
  | 'scheduling'
  | 'authentication'
  | 'deployment'
  | 'monitoring'
  | 'data'
  | 'browser'
  | 'physical'
  | 'data_protection'
  | 'custom';

// ============================================================================
// Category Definitions
// ============================================================================

/**
 * All knobs organized by category
 */
export const KNOB_DEFINITIONS: Record<KnobCategory, KnobDefinition[]> = {
  // Terminal (10 knobs)
  terminal: [
    {
      id: 'command_exec',
      name: 'Command Execution',
      description: 'Execute shell commands',
      default: 'allow',
      overridable: true,
      category: 'terminal',
    },
    {
      id: 'destructive_commands',
      name: 'Destructive Commands',
      description: 'Commands that can delete/modify system state (rm, mv, etc.)',
      default: 'block',
      overridable: true,
      category: 'terminal',
    },
    {
      id: 'network_commands',
      name: 'Network Commands',
      description: 'Commands that access the network (curl, wget, nc)',
      default: 'allow',
      overridable: true,
      category: 'terminal',
    },
    {
      id: 'package_installs',
      name: 'Package Installs',
      description: 'Install packages via npm, pip, apt, etc.',
      default: 'approve',
      overridable: true,
      category: 'terminal',
    },
    {
      id: 'sudo',
      name: 'Sudo Commands',
      description: 'Commands requiring elevated privileges',
      default: 'block',
      overridable: true,
      category: 'terminal',
    },
    {
      id: 'pipe_to_shell',
      name: 'Pipe to Shell',
      description: 'Piping output to sh/bash (curl | bash)',
      default: 'block',
      overridable: false, // HARDCODED
      category: 'terminal',
    },
    {
      id: 'kill_processes',
      name: 'Kill Processes',
      description: 'Terminate running processes',
      default: 'approve',
      overridable: true,
      category: 'terminal',
    },
    {
      id: 'daemons',
      name: 'Daemon Management',
      description: 'Start/stop system daemons and services',
      default: 'block',
      overridable: true,
      category: 'terminal',
    },
    {
      id: 'cron_jobs',
      name: 'Cron Jobs',
      description: 'Create or modify cron jobs',
      default: 'block',
      overridable: true,
      category: 'terminal',
    },
    {
      id: 'max_subprocesses',
      name: 'Max Subprocesses',
      description: 'Limit on concurrent subprocesses',
      default: 'allow',
      overridable: true,
      category: 'terminal',
    },
  ],

  // Filesystem (8 knobs)
  filesystem: [
    {
      id: 'file_read',
      name: 'File Read',
      description: 'Read file contents',
      default: 'allow',
      overridable: true,
      category: 'filesystem',
    },
    {
      id: 'file_write',
      name: 'File Write',
      description: 'Write/modify file contents',
      default: 'allow',
      overridable: true,
      category: 'filesystem',
    },
    {
      id: 'file_delete',
      name: 'File Delete',
      description: 'Delete files',
      default: 'approve',
      overridable: true,
      category: 'filesystem',
    },
    {
      id: 'directory_create',
      name: 'Directory Create',
      description: 'Create directories',
      default: 'allow',
      overridable: true,
      category: 'filesystem',
    },
    {
      id: 'directory_delete',
      name: 'Directory Delete',
      description: 'Delete directories',
      default: 'approve',
      overridable: true,
      category: 'filesystem',
    },
    {
      id: 'symlink_create',
      name: 'Symlink Create',
      description: 'Create symbolic links',
      default: 'approve',
      overridable: true,
      category: 'filesystem',
    },
    {
      id: 'permissions_change',
      name: 'Permissions Change',
      description: 'Change file/directory permissions',
      default: 'block',
      overridable: true,
      category: 'filesystem',
    },
    {
      id: 'file_move',
      name: 'File Move',
      description: 'Move/rename files',
      default: 'allow',
      overridable: true,
      category: 'filesystem',
    },
  ],

  // Git (7 knobs)
  git: [
    {
      id: 'git_read',
      name: 'Git Read',
      description: 'Read git state (status, log, diff, branch)',
      default: 'allow',
      overridable: true,
      category: 'git',
    },
    {
      id: 'git_commit',
      name: 'Git Commit',
      description: 'Create git commits',
      default: 'allow',
      overridable: true,
      category: 'git',
    },
    {
      id: 'git_push',
      name: 'Git Push',
      description: 'Push commits to remote',
      default: 'allow',
      overridable: true,
      category: 'git',
    },
    {
      id: 'git_force_push',
      name: 'Git Force Push',
      description: 'Force push to remote',
      default: 'approve',
      overridable: true,
      category: 'git',
    },
    {
      id: 'git_branch_delete',
      name: 'Git Branch Delete',
      description: 'Delete git branches',
      default: 'approve',
      overridable: true,
      category: 'git',
    },
    {
      id: 'git_tag',
      name: 'Git Tag',
      description: 'Create or delete git tags',
      default: 'allow',
      overridable: true,
      category: 'git',
    },
    {
      id: 'git_rebase',
      name: 'Git Rebase',
      description: 'Interactive git rebase',
      default: 'approve',
      overridable: true,
      category: 'git',
    },
  ],

  // Network (5 knobs)
  network: [
    {
      id: 'http_request',
      name: 'HTTP Request',
      description: 'Make HTTP/HTTPS requests',
      default: 'allow',
      overridable: true,
      category: 'network',
    },
    {
      id: 'websocket',
      name: 'WebSocket',
      description: 'Open WebSocket connections',
      default: 'allow',
      overridable: true,
      category: 'network',
    },
    {
      id: 'dns_lookup',
      name: 'DNS Lookup',
      description: 'Perform DNS lookups',
      default: 'allow',
      overridable: true,
      category: 'network',
    },
    {
      id: 'domain_allowlist',
      name: 'Domain Allowlist',
      description: 'Allowed domains (empty = all allowed)',
      default: 'allow',
      overridable: true,
      category: 'network',
    },
    {
      id: 'domain_blocklist',
      name: 'Domain Blocklist',
      description: 'Blocked domains',
      default: 'allow',
      overridable: true,
      category: 'network',
    },
  ],

  // Database (5 knobs)
  database: [
    {
      id: 'db_read',
      name: 'Database Read',
      description: 'Read from database (SELECT)',
      default: 'allow',
      overridable: true,
      category: 'database',
    },
    {
      id: 'db_write',
      name: 'Database Write',
      description: 'Write to database (INSERT, UPDATE)',
      default: 'allow',
      overridable: true,
      category: 'database',
    },
    {
      id: 'db_delete',
      name: 'Database Delete',
      description: 'Delete from database (DELETE, TRUNCATE)',
      default: 'approve',
      overridable: true,
      category: 'database',
    },
    {
      id: 'db_schema_change',
      name: 'Database Schema Change',
      description: 'Modify database schema (CREATE, ALTER, DROP)',
      default: 'block',
      overridable: true,
      category: 'database',
    },
    {
      id: 'db_admin',
      name: 'Database Admin',
      description: 'Administrative database operations',
      default: 'block',
      overridable: true,
      category: 'database',
    },
  ],

  // Financial (6 knobs)
  financial: [
    {
      id: 'payment_read',
      name: 'Payment Read',
      description: 'Read payment information',
      default: 'allow',
      overridable: true,
      category: 'financial',
    },
    {
      id: 'payment_create',
      name: 'Payment Create',
      description: 'Create payments',
      default: 'approve',
      overridable: true,
      category: 'financial',
    },
    {
      id: 'payment_over_threshold',
      name: 'Payment Over Threshold',
      description: 'Payments over configured threshold',
      default: 'approve',
      overridable: true,
      category: 'financial',
    },
    {
      id: 'transfer',
      name: 'Transfer',
      description: 'Transfer funds',
      default: 'approve',
      overridable: true,
      category: 'financial',
    },
    {
      id: 'subscription_change',
      name: 'Subscription Change',
      description: 'Modify subscriptions',
      default: 'approve',
      overridable: true,
      category: 'financial',
    },
    {
      id: 'refund',
      name: 'Refund',
      description: 'Issue refunds',
      default: 'approve',
      overridable: true,
      category: 'financial',
    },
  ],

  // API (5 knobs)
  api: [
    {
      id: 'api_read',
      name: 'API Read',
      description: 'Read from APIs (GET)',
      default: 'allow',
      overridable: true,
      category: 'api',
    },
    {
      id: 'api_write',
      name: 'API Write',
      description: 'Write to APIs (POST, PUT, PATCH)',
      default: 'allow',
      overridable: true,
      category: 'api',
    },
    {
      id: 'api_delete',
      name: 'API Delete',
      description: 'Delete via APIs (DELETE)',
      default: 'approve',
      overridable: true,
      category: 'api',
    },
    {
      id: 'api_admin',
      name: 'API Admin',
      description: 'Administrative API operations',
      default: 'block',
      overridable: true,
      category: 'api',
    },
    {
      id: 'rate_limit',
      name: 'Rate Limit',
      description: 'Respect API rate limits',
      default: 'allow',
      overridable: true,
      category: 'api',
    },
  ],

  // Communication (6 knobs)
  communication: [
    {
      id: 'message_read',
      name: 'Message Read',
      description: 'Read messages',
      default: 'allow',
      overridable: true,
      category: 'communication',
    },
    {
      id: 'email_send',
      name: 'Email Send',
      description: 'Send emails',
      default: 'approve',
      overridable: true,
      category: 'communication',
    },
    {
      id: 'message_send',
      name: 'Message Send',
      description: 'Send messages (Slack, Discord, etc.)',
      default: 'approve',
      overridable: true,
      category: 'communication',
    },
    {
      id: 'notification_send',
      name: 'Notification Send',
      description: 'Send push notifications',
      default: 'approve',
      overridable: true,
      category: 'communication',
    },
    {
      id: 'calendar_create',
      name: 'Calendar Create',
      description: 'Create calendar events',
      default: 'approve',
      overridable: true,
      category: 'communication',
    },
    {
      id: 'contact_modify',
      name: 'Contact Modify',
      description: 'Modify contacts',
      default: 'approve',
      overridable: true,
      category: 'communication',
    },
  ],

  // Cloud Infrastructure (6 knobs)
  cloud: [
    {
      id: 'cloud_read',
      name: 'Cloud Read',
      description: 'Read cloud infrastructure state',
      default: 'allow',
      overridable: true,
      category: 'cloud',
    },
    {
      id: 'instance_create',
      name: 'Instance Create',
      description: 'Create cloud instances',
      default: 'approve',
      overridable: true,
      category: 'cloud',
    },
    {
      id: 'instance_delete',
      name: 'Instance Delete',
      description: 'Delete cloud instances',
      default: 'block',
      overridable: true,
      category: 'cloud',
    },
    {
      id: 'storage_modify',
      name: 'Storage Modify',
      description: 'Modify cloud storage',
      default: 'approve',
      overridable: true,
      category: 'cloud',
    },
    {
      id: 'network_modify',
      name: 'Network Modify',
      description: 'Modify cloud networking',
      default: 'block',
      overridable: true,
      category: 'cloud',
    },
    {
      id: 'iam_change',
      name: 'IAM Change',
      description: 'Modify IAM policies',
      default: 'block',
      overridable: true,
      category: 'cloud',
    },
  ],

  // Container (6 knobs)
  container: [
    {
      id: 'container_read',
      name: 'Container Read',
      description: 'Read container state',
      default: 'allow',
      overridable: true,
      category: 'container',
    },
    {
      id: 'container_exec',
      name: 'Container Exec',
      description: 'Execute commands in containers',
      default: 'approve',
      overridable: true,
      category: 'container',
    },
    {
      id: 'container_create',
      name: 'Container Create',
      description: 'Create containers',
      default: 'approve',
      overridable: true,
      category: 'container',
    },
    {
      id: 'container_delete',
      name: 'Container Delete',
      description: 'Delete containers',
      default: 'approve',
      overridable: true,
      category: 'container',
    },
    {
      id: 'image_pull',
      name: 'Image Pull',
      description: 'Pull container images',
      default: 'allow',
      overridable: true,
      category: 'container',
    },
    {
      id: 'volume_mount',
      name: 'Volume Mount',
      description: 'Mount volumes to containers',
      default: 'approve',
      overridable: true,
      category: 'container',
    },
  ],

  // Package Management (5 knobs)
  package: [
    {
      id: 'package_read',
      name: 'Package Read',
      description: 'Read package information',
      default: 'allow',
      overridable: true,
      category: 'package',
    },
    {
      id: 'install',
      name: 'Package Install',
      description: 'Install packages',
      default: 'approve',
      overridable: true,
      category: 'package',
    },
    {
      id: 'uninstall',
      name: 'Package Uninstall',
      description: 'Uninstall packages',
      default: 'approve',
      overridable: true,
      category: 'package',
    },
    {
      id: 'update',
      name: 'Package Update',
      description: 'Update packages',
      default: 'approve',
      overridable: true,
      category: 'package',
    },
    {
      id: 'publish',
      name: 'Package Publish',
      description: 'Publish packages',
      default: 'block',
      overridable: true,
      category: 'package',
    },
    {
      id: 'package_audit',
      name: 'Package Audit',
      description: 'Run package security audits',
      default: 'allow',
      overridable: true,
      category: 'package',
    },
  ],

  // Scheduling (5 knobs)
  scheduling: [
    {
      id: 'schedule_read',
      name: 'Schedule Read',
      description: 'Read scheduled tasks',
      default: 'allow',
      overridable: true,
      category: 'scheduling',
    },
    {
      id: 'cron_create',
      name: 'Cron Create',
      description: 'Create cron jobs',
      default: 'block',
      overridable: true,
      category: 'scheduling',
    },
    {
      id: 'timer_create',
      name: 'Timer Create',
      description: 'Create timers/scheduled tasks',
      default: 'approve',
      overridable: true,
      category: 'scheduling',
    },
    {
      id: 'cron_delete',
      name: 'Cron Delete',
      description: 'Delete cron jobs',
      default: 'approve',
      overridable: true,
      category: 'scheduling',
    },
    {
      id: 'scheduled_task',
      name: 'Scheduled Task',
      description: 'Execute scheduled tasks',
      default: 'allow',
      overridable: true,
      category: 'scheduling',
    },
  ],

  // Authentication (3 knobs)
  authentication: [
    {
      id: 'credential_read',
      name: 'Credential Read',
      description: 'Read credentials',
      default: 'allow',
      overridable: true,
      category: 'authentication',
    },
    {
      id: 'credential_write',
      name: 'Credential Write',
      description: 'Write credentials',
      default: 'block',
      overridable: true,
      category: 'authentication',
    },
    {
      id: 'credential_delete',
      name: 'Credential Delete',
      description: 'Delete credentials',
      default: 'block',
      overridable: true,
      category: 'authentication',
    },
    {
      id: 'session_create',
      name: 'Session Create',
      description: 'Create sessions',
      default: 'allow',
      overridable: true,
      category: 'authentication',
    },
  ],

  // Deployment (5 knobs)
  deployment: [
    {
      id: 'deployment_read',
      name: 'Deployment Read',
      description: 'Read deployment status',
      default: 'allow',
      overridable: true,
      category: 'deployment',
    },
    {
      id: 'deploy_staging',
      name: 'Deploy Staging',
      description: 'Deploy to staging',
      default: 'allow',
      overridable: true,
      category: 'deployment',
    },
    {
      id: 'deploy_production',
      name: 'Deploy Production',
      description: 'Deploy to production',
      default: 'block',
      overridable: true,
      category: 'deployment',
    },
    {
      id: 'rollback',
      name: 'Rollback',
      description: 'Rollback deployments',
      default: 'approve',
      overridable: true,
      category: 'deployment',
    },
    {
      id: 'scale',
      name: 'Scale',
      description: 'Scale services',
      default: 'approve',
      overridable: true,
      category: 'deployment',
    },
  ],

  // Monitoring (3 knobs)
  monitoring: [
    {
      id: 'log_read',
      name: 'Log Read',
      description: 'Read logs',
      default: 'allow',
      overridable: true,
      category: 'monitoring',
    },
    {
      id: 'metrics_read',
      name: 'Metrics Read',
      description: 'Read metrics',
      default: 'allow',
      overridable: true,
      category: 'monitoring',
    },
    {
      id: 'log_write',
      name: 'Log Write',
      description: 'Write to logs',
      default: 'approve',
      overridable: true,
      category: 'monitoring',
    },
    {
      id: 'alert_create',
      name: 'Alert Create',
      description: 'Create alerts',
      default: 'approve',
      overridable: true,
      category: 'monitoring',
    },
  ],

  // Data (6 knobs)
  data: [
    {
      id: 'data_read',
      name: 'Data Read',
      description: 'Read data',
      default: 'allow',
      overridable: true,
      category: 'data',
    },
    {
      id: 'export',
      name: 'Data Export',
      description: 'Export data',
      default: 'approve',
      overridable: true,
      category: 'data',
    },
    {
      id: 'import',
      name: 'Data Import',
      description: 'Import data',
      default: 'approve',
      overridable: true,
      category: 'data',
    },
    {
      id: 'backup',
      name: 'Backup',
      description: 'Create backups',
      default: 'allow',
      overridable: true,
      category: 'data',
    },
    {
      id: 'data_delete',
      name: 'Data Delete',
      description: 'Delete data',
      default: 'approve',
      overridable: true,
      category: 'data',
    },
    {
      id: 'transform',
      name: 'Transform',
      description: 'Transform data',
      default: 'allow',
      overridable: true,
      category: 'data',
    },
  ],

  // Browser (4 knobs)
  browser: [
    {
      id: 'browser_read',
      name: 'Browser Read',
      description: 'Read browser content',
      default: 'allow',
      overridable: true,
      category: 'browser',
    },
    {
      id: 'navigate',
      name: 'Navigate',
      description: 'Navigate to URLs',
      default: 'allow',
      overridable: true,
      category: 'browser',
    },
    {
      id: 'form_submit',
      name: 'Form Submit',
      description: 'Submit forms',
      default: 'approve',
      overridable: true,
      category: 'browser',
    },
    {
      id: 'download',
      name: 'Download',
      description: 'Download files',
      default: 'allow',
      overridable: true,
      category: 'browser',
    },
  ],

  // Physical (3 knobs)
  physical: [
    {
      id: 'iot_command',
      name: 'IoT Command',
      description: 'Send IoT commands',
      default: 'approve',
      overridable: true,
      category: 'physical',
    },
    {
      id: 'hardware_control',
      name: 'Hardware Control',
      description: 'Control hardware',
      default: 'block',
      overridable: true,
      category: 'physical',
    },
    {
      id: 'sensor_read',
      name: 'Sensor Read',
      description: 'Read sensor data',
      default: 'allow',
      overridable: true,
      category: 'physical',
    },
  ],

  // Data Protection (5 knobs)
  data_protection: [
    {
      id: 'block_secrets',
      name: 'Block Secrets',
      description: 'Block tool calls that would expose secrets (API keys, tokens)',
      default: 'block',
      overridable: true,
      category: 'data_protection',
    },
    {
      id: 'block_pii',
      name: 'Block PII',
      description: 'Block tool calls that would expose personally identifiable information',
      default: 'block',
      overridable: true,
      category: 'data_protection',
    },
    {
      id: 'block_api_keys',
      name: 'Block API Keys',
      description: 'Block tool calls that would expose API keys',
      default: 'block',
      overridable: true,
      category: 'data_protection',
    },
    {
      id: 'block_credentials',
      name: 'Block Credentials',
      description: 'Block tool calls that would expose credentials (passwords, auth tokens)',
      default: 'block',
      overridable: true,
      category: 'data_protection',
    },
    {
      id: 'block_tokens',
      name: 'Block Tokens',
      description: 'Block tool calls that would expose bearer/session/refresh tokens',
      default: 'block',
      overridable: true,
      category: 'data_protection',
    },
  ],

  // Custom (user-defined)
  custom: [],
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get all knob IDs
 */
export function getAllKnobIds(): string[] {
  const ids: string[] = [];
  for (const defs of Object.values(KNOB_DEFINITIONS)) {
    for (const def of defs) {
      ids.push(def.id);
    }
  }
  return ids;
}

/**
 * Get knob definition by ID
 */
export function getKnobDefinition(id: string): KnobDefinition | undefined {
  for (const defs of Object.values(KNOB_DEFINITIONS)) {
    const found = defs.find((d) => d.id === id);
    if (found) return found;
  }
  return undefined;
}

/**
 * Get all knobs for a category
 */
export function getKnobsForCategory(category: KnobCategory): KnobDefinition[] {
  return KNOB_DEFINITIONS[category] || [];
}

/**
 * Check if a knob is hardcoded (cannot be overridden)
 */
export function isHardcodedKnob(id: string): boolean {
  const def = getKnobDefinition(id);
  return def ? !def.overridable : false;
}

/**
 * Get default knob values as a flat record
 */
export function getDefaultKnobValues(): Record<string, KnobValue> {
  const values: Record<string, KnobValue> = {};
  for (const defs of Object.values(KNOB_DEFINITIONS)) {
    for (const def of defs) {
      values[def.id] = def.default;
    }
  }
  return values;
}

/**
 * Knob value ordering for strictest-wins merge
 */
export const KNOB_VALUE_ORDER: Record<KnobValue, number> = {
  allow: 0,
  approve: 1,
  block: 2,
};

/**
 * Get the more restrictive knob value
 */
export function maxKnobValue(a: KnobValue, b: KnobValue): KnobValue {
  return KNOB_VALUE_ORDER[a] >= KNOB_VALUE_ORDER[b] ? a : b;
}
