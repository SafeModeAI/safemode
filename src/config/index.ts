/**
 * Configuration System
 *
 * Handles loading and merging configuration from multiple sources:
 * 1. Preset defaults
 * 2. ~/.safemode/config.yaml (personal)
 * 3. .safemode.yaml (project/repo)
 * 4. Cloud policy (future)
 * 5. Hardcoded invariants (always win)
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import yaml from 'js-yaml';
import {
  type KnobValue,
  type KnobCategory,
  getDefaultKnobValues,
  maxKnobValue,
  isHardcodedKnob,
} from '../knobs/categories.js';

// ============================================================================
// Types
// ============================================================================

export type PresetName = 'yolo' | 'coding' | 'personal' | 'trading' | 'strict';

export interface SafeModeConfig {
  /** Config file format version (required: "1.0") */
  version: string;

  /** Active preset */
  preset: PresetName;

  /** Knob overrides by category */
  overrides: Partial<Record<KnobCategory, Record<string, KnobValue>>>;

  /** Budget configuration */
  budget: {
    max_session_cost: number;
    max_daily_cost?: number;
    alert_at: number;
    cost_per_call?: number;
  };

  /** Approve fallback behavior */
  approve_fallback: 'allow' | 'block';

  /** ML engines enabled */
  ml_enabled: boolean;

  /** Cloud bridge connected */
  cloud_connected: boolean;

  /** Notification provider configuration */
  notifications?: {
    provider: 'telegram' | 'discord' | null;
    telegram?: { bot_token: string; chat_id: string };
    discord?: { webhook_url: string };
  };

  /** Custom rules (loaded from config files) */
  rules?: Array<Record<string, unknown>>;
}

export interface LoadedConfig extends SafeModeConfig {
  /** Merged knob values */
  knobs: Record<string, KnobValue>;

  /** Source files that were loaded */
  sources: string[];
}

// ============================================================================
// Paths
// ============================================================================

const SAFEMODE_DIR = path.join(os.homedir(), '.safemode');
const PERSONAL_CONFIG = path.join(SAFEMODE_DIR, 'config.yaml');
const PROJECT_CONFIG = '.safemode.yaml';

export const CONFIG_PATHS = {
  safemodeDir: SAFEMODE_DIR,
  personalConfig: PERSONAL_CONFIG,
  projectConfig: PROJECT_CONFIG,
  eventsDir: path.join(SAFEMODE_DIR, 'events'),
  modelsDir: path.join(SAFEMODE_DIR, 'models'),
  cacheDir: path.join(SAFEMODE_DIR, 'cache'),
  pinsDir: path.join(SAFEMODE_DIR, 'pins'),
  backupDir: path.join(SAFEMODE_DIR, 'backup'),
};

// ============================================================================
// MCP Client Config Paths
// ============================================================================

export const MCP_CLIENT_PATHS: Record<string, string[]> = {
  'Claude Desktop': [
    // macOS
    path.join(os.homedir(), 'Library/Application Support/Claude/claude_desktop_config.json'),
    // Windows (via platform check)
    process.platform === 'win32'
      ? path.join(process.env.APPDATA || '', 'Claude/claude_desktop_config.json')
      : '',
    // Linux
    path.join(os.homedir(), '.config/Claude/claude_desktop_config.json'),
  ].filter(Boolean),

  Cursor: [
    path.join(os.homedir(), '.cursor/mcp.json'),
    path.join(process.cwd(), '.cursor/mcp.json'),
  ],

  'VS Code': [
    path.join(os.homedir(), '.vscode/mcp.json'),
    path.join(process.cwd(), '.vscode/mcp.json'),
  ],

  'Claude Code': [
    path.join(os.homedir(), '.claude/mcp_servers.json'),
  ],

  Windsurf: [
    path.join(os.homedir(), '.windsurf/mcp.json'),
  ],
};

// ============================================================================
// Preset Defaults
// ============================================================================

const PRESET_DEFAULTS: Record<PresetName, Partial<SafeModeConfig>> = {
  yolo: {
    preset: 'yolo',
    approve_fallback: 'allow',
    budget: { max_session_cost: 100, alert_at: 80 },
    overrides: {
      // Override ALL overridable default-block knobs to allow.
      // Only hardcoded knobs (pipe_to_shell) and Command Firewall remain.
      terminal: {
        destructive_commands: 'allow',
        sudo: 'allow',
        daemons: 'allow',
        cron_jobs: 'allow',
      },
      filesystem: {
        permissions_change: 'allow',
      },
      database: {
        db_schema_change: 'allow',
        db_admin: 'allow',
      },
      api: {
        api_admin: 'allow',
      },
      cloud: {
        instance_delete: 'allow',
        network_modify: 'allow',
        iam_change: 'allow',
      },
      physical: {
        hardware_control: 'allow',
      },
      package: {
        publish: 'allow',
      },
      scheduling: {
        cron_create: 'allow',
      },
      authentication: {
        credential_write: 'allow',
        credential_delete: 'allow',
      },
      deployment: {
        deploy_production: 'allow',
      },
      data_protection: {
        block_secrets: 'allow',
        block_pii: 'allow',
        block_api_keys: 'allow',
        block_credentials: 'allow',
        block_tokens: 'allow',
      },
    },
  },
  coding: {
    preset: 'coding',
    approve_fallback: 'block',
    budget: { max_session_cost: 20, alert_at: 16 },
    overrides: {
      terminal: {
        destructive_commands: 'block',
      },
      filesystem: {
        file_delete: 'approve',
        directory_delete: 'approve',
      },
      git: {
        git_force_push: 'approve',
      },
      package: {
        install: 'approve',
      },
    },
  },
  personal: {
    preset: 'personal',
    approve_fallback: 'block',
    budget: { max_session_cost: 10, alert_at: 8 },
    overrides: {
      terminal: {
        command_exec: 'block',
        destructive_commands: 'block',
      },
      package: {
        install: 'block',
      },
    },
  },
  trading: {
    preset: 'trading',
    approve_fallback: 'block',
    budget: { max_session_cost: 50, max_daily_cost: 500, alert_at: 40 },
    overrides: {
      terminal: {
        command_exec: 'block',
      },
      filesystem: {
        file_write: 'block',
        file_delete: 'block',
      },
      financial: {
        payment_create: 'approve',
        transfer: 'approve',
      },
    },
  },
  strict: {
    preset: 'strict',
    approve_fallback: 'block',
    budget: { max_session_cost: 5, alert_at: 4 },
    overrides: {
      terminal: {
        command_exec: 'block',
      },
      filesystem: {
        file_write: 'block',
        file_delete: 'block',
        directory_delete: 'block',
      },
      git: {
        git_push: 'block',
      },
      database: {
        db_write: 'block',
        db_delete: 'block',
      },
    },
  },
};

// ============================================================================
// Config Loader
// ============================================================================

export class ConfigLoader {
  private config: LoadedConfig | null = null;

  /**
   * Load configuration from all sources
   */
  async load(cwd: string = process.cwd()): Promise<LoadedConfig> {
    const sources: string[] = [];

    // Start with default preset
    let preset: PresetName = 'coding';
    let baseConfig = this.getPresetDefaults(preset);

    // Try to load personal config
    const personalConfig = this.loadYamlConfig(PERSONAL_CONFIG);
    if (personalConfig) {
      sources.push(PERSONAL_CONFIG);
      this.validateConfig(personalConfig, PERSONAL_CONFIG);
      preset = personalConfig.preset || preset;
      baseConfig = this.mergeConfigs(baseConfig, personalConfig);
    }

    // Walk up directory tree for .safemode.yaml
    const projectConfig = this.findProjectConfig(cwd);
    if (projectConfig) {
      const config = this.loadYamlConfig(projectConfig);
      if (config) {
        sources.push(projectConfig);
        this.validateConfig(config, projectConfig);
        preset = config.preset || preset;
        baseConfig = this.mergeConfigs(baseConfig, config);
      }
    }

    // Compute final knob values
    const knobs = this.computeKnobs(preset, baseConfig.overrides || {});

    this.config = {
      version: '1.0',
      preset,
      overrides: baseConfig.overrides || {},
      budget: baseConfig.budget || PRESET_DEFAULTS[preset].budget!,
      approve_fallback: baseConfig.approve_fallback || PRESET_DEFAULTS[preset].approve_fallback!,
      ml_enabled: baseConfig.ml_enabled ?? false,
      cloud_connected: baseConfig.cloud_connected ?? false,
      rules: baseConfig.rules,
      knobs,
      sources,
    };

    return this.config;
  }

  /**
   * Get currently loaded config
   */
  getConfig(): LoadedConfig | null {
    return this.config;
  }

  /**
   * Load a YAML config file
   */
  private loadYamlConfig(filePath: string): Partial<SafeModeConfig> | null {
    try {
      if (!fs.existsSync(filePath)) {
        return null;
      }
      const content = fs.readFileSync(filePath, 'utf8');
      return yaml.load(content) as Partial<SafeModeConfig>;
    } catch (error) {
      console.error(`Error loading config from ${filePath}:`, error);
      return null;
    }
  }

  /**
   * Validate config structure
   */
  private validateConfig(config: Partial<SafeModeConfig>, source: string): void {
    if (!config.version) {
      throw new Error(
        `Invalid config at ${source}: missing required 'version: "1.0"' field`
      );
    }
    if (config.version !== '1.0') {
      throw new Error(
        `Invalid config at ${source}: unsupported version "${config.version}" (expected "1.0")`
      );
    }
  }

  /**
   * Find .safemode.yaml by walking up directory tree
   */
  private findProjectConfig(startDir: string): string | null {
    let dir = startDir;
    const root = path.parse(dir).root;

    while (dir !== root) {
      const configPath = path.join(dir, PROJECT_CONFIG);
      if (fs.existsSync(configPath)) {
        return configPath;
      }
      dir = path.dirname(dir);
    }

    return null;
  }

  /**
   * Get defaults for a preset
   */
  private getPresetDefaults(preset: PresetName): Partial<SafeModeConfig> {
    return PRESET_DEFAULTS[preset] || PRESET_DEFAULTS.coding;
  }

  /**
   * Merge two configs (strictest wins per knob)
   */
  private mergeConfigs(
    base: Partial<SafeModeConfig>,
    override: Partial<SafeModeConfig>
  ): Partial<SafeModeConfig> {
    const merged: Partial<SafeModeConfig> = { ...base };

    // Merge overrides (strictest wins)
    if (override.overrides) {
      merged.overrides = merged.overrides || {};
      for (const [category, knobs] of Object.entries(override.overrides)) {
        const cat = category as KnobCategory;
        merged.overrides[cat] = merged.overrides[cat] || {};
        for (const [knob, value] of Object.entries(knobs || {})) {
          const existing = merged.overrides[cat]![knob];
          merged.overrides[cat]![knob] = existing
            ? maxKnobValue(existing, value as KnobValue)
            : (value as KnobValue);
        }
      }
    }

    // Override simple fields
    if (override.preset) merged.preset = override.preset;
    if (override.approve_fallback) merged.approve_fallback = override.approve_fallback;
    if (override.ml_enabled !== undefined) merged.ml_enabled = override.ml_enabled;
    if (override.budget) {
      merged.budget = {
        ...merged.budget,
        ...override.budget,
      } as SafeModeConfig['budget'];
    }

    // Merge rules (project rules append to personal rules)
    if (override.rules) {
      merged.rules = [...(merged.rules || []), ...override.rules];
    }

    return merged;
  }

  /**
   * Compute final knob values from preset + overrides + hardcoded
   */
  private computeKnobs(
    preset: PresetName,
    overrides: Partial<Record<KnobCategory, Record<string, KnobValue>>>
  ): Record<string, KnobValue> {
    // Start with defaults
    const knobs = getDefaultKnobValues();

    // Apply preset overrides
    const presetOverrides = PRESET_DEFAULTS[preset].overrides || {};
    for (const [_category, catKnobs] of Object.entries(presetOverrides)) {
      for (const [knob, value] of Object.entries(catKnobs || {})) {
        if (!isHardcodedKnob(knob)) {
          knobs[knob] = value as KnobValue;
        }
      }
    }

    // Apply user overrides (strictest wins)
    for (const catKnobs of Object.values(overrides)) {
      for (const [knob, value] of Object.entries(catKnobs || {})) {
        if (!isHardcodedKnob(knob)) {
          const existing = knobs[knob];
          knobs[knob] = existing ? maxKnobValue(existing, value) : value;
        }
      }
    }

    return knobs;
  }

  /**
   * Ensure required directories exist
   */
  static ensureDirectories(): void {
    const dirs = [
      CONFIG_PATHS.safemodeDir,
      CONFIG_PATHS.eventsDir,
      CONFIG_PATHS.modelsDir,
      CONFIG_PATHS.cacheDir,
      CONFIG_PATHS.pinsDir,
      CONFIG_PATHS.backupDir,
    ];

    for (const dir of dirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
  }

  /**
   * Write default config file
   */
  static writeDefaultConfig(preset: PresetName): void {
    ConfigLoader.ensureDirectories();

    const presetDef = PRESET_DEFAULTS[preset] || PRESET_DEFAULTS.coding;
    const config: Record<string, unknown> = {
      version: '1.0',
      preset,
      approve_fallback: presetDef.approve_fallback || 'block',
      overrides: presetDef.overrides || {},
      budget: presetDef.budget,
    };

    fs.writeFileSync(PERSONAL_CONFIG, yaml.dump(config));
  }

  /**
   * Detect installed MCP clients
   */
  static detectMCPClients(): Array<{ name: string; path: string; servers: number }> {
    const results: Array<{ name: string; path: string; servers: number }> = [];

    for (const [clientName, paths] of Object.entries(MCP_CLIENT_PATHS)) {
      for (const configPath of paths) {
        if (fs.existsSync(configPath)) {
          try {
            const content = fs.readFileSync(configPath, 'utf8');
            const config = JSON.parse(content);
            const servers = Object.keys(config.mcpServers || {}).length;
            results.push({ name: clientName, path: configPath, servers });
          } catch {
            // Invalid JSON, skip
          }
        }
      }
    }

    return results;
  }
}
