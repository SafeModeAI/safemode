/**
 * ATSP (Adaptive Tool Schema Projection)
 *
 * Pre-cognitive governance: rewrites tool schemas BEFORE the AI sees them.
 * Core principle: REPLACE-NEVER-APPEND
 */

import type { MCPTool, MCPToolProperty } from '../proxy/protocol.js';
import type { ToolCategory } from '../cet/types.js';
import type { KnobValue } from '../knobs/categories.js';

// ============================================================================
// Types
// ============================================================================

export type CapabilityLevel = 'disabled' | 'read_only' | 'scoped_write' | 'full_access';

export interface ATSPConfig {
  /** Capability levels per category */
  levels: Partial<Record<ToolCategory, CapabilityLevel>>;

  /** Project directory for scoped_write */
  projectDir: string;

  /** Additional allowed paths for scoped_write */
  allowedPaths: string[];

  /** Knob values for reference */
  knobs: Record<string, KnobValue>;
}

// ============================================================================
// Hardcoded Invariants (Cannot be disabled)
// ============================================================================

const HARDCODED_BLOCKED_COMMANDS = [
  // Disk destruction
  /rm\s+(-rf?|--recursive)\s+\/(\s|$)/i,
  /rm\s+(-rf?|--recursive)\s+\/\*/i,
  /rm\s+(-rf?|--recursive)\s+~\//i,
  /mkfs(\.\w+)?\s+/i,
  /dd\s+if=\/dev\/(zero|random|urandom)/i,

  // Fork bombs
  /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;?\s*:/,
  /\.\/?\s*&\s*\.\/?\s*&/,

  // Permission abuse
  /chmod\s+(-R\s+)?777\s+\//i,
  /chown\s+(-R\s+)?\w+:\w+\s+\//i,

  // Raw disk access
  />\s*\/dev\/sd[a-z]/i,
  /dd\s+of=\/dev\/sd[a-z]/i,

  // Pipe to shell (always blocked)
  /(curl|wget)\s+.*\|\s*(sh|bash|zsh)/i,
  /\|\s*(sh|bash|zsh)\s*$/i,
];

// ============================================================================
// ATSP Engine
// ============================================================================

export class ATSPEngine {
  constructor(private config: ATSPConfig) {}

  /**
   * Rewrite tools based on capability levels
   */
  rewrite(tools: MCPTool[]): MCPTool[] {
    const result: MCPTool[] = [];

    for (const tool of tools) {
      const rewritten = this.rewriteTool(tool);
      if (rewritten) {
        result.push(rewritten);
      }
    }

    return result;
  }

  /**
   * Rewrite a single tool
   */
  private rewriteTool(tool: MCPTool): MCPTool | null {
    // Get capability level for this tool's category
    const category = this.inferCategory(tool);
    const level = this.config.levels[category] || 'full_access';

    switch (level) {
      case 'disabled':
        // Remove tool entirely
        return null;

      case 'read_only':
        // Only keep if it's a read operation
        if (this.isWriteOperation(tool)) {
          return null;
        }
        return this.applyHardcodedInvariants(tool);

      case 'scoped_write':
        // Constrain write operations to allowed paths
        return this.applyHardcodedInvariants(
          this.constrainToScope(tool)
        );

      case 'full_access':
        // Only apply hardcoded invariants
        return this.applyHardcodedInvariants(tool);

      default:
        return this.applyHardcodedInvariants(tool);
    }
  }

  /**
   * Apply hardcoded invariants that cannot be overridden
   */
  private applyHardcodedInvariants(tool: MCPTool): MCPTool {
    // Clone the tool
    const result = JSON.parse(JSON.stringify(tool)) as MCPTool;

    // Check if this is a command execution tool
    if (this.isCommandTool(tool)) {
      // Remove dangerous command patterns from schema
      result.inputSchema = this.sanitizeCommandSchema(result.inputSchema);
    }

    return result;
  }

  /**
   * Sanitize command schema to exclude dangerous patterns
   */
  private sanitizeCommandSchema(schema: MCPTool['inputSchema']): MCPTool['inputSchema'] {
    const result = JSON.parse(JSON.stringify(schema));

    // If there's a command property, add pattern constraint
    if (result.properties?.command) {
      // We can't use negative lookahead in JSON Schema, so we'll rely on
      // runtime detection in the Command Firewall engine.
      // But we can document the constraint in the description.

      // REPLACE-NEVER-APPEND: rewrite description
      result.properties.command.description =
        'Command to execute. Destructive commands (rm -rf /, mkfs, etc.) are blocked.';
    }

    return result;
  }

  /**
   * Constrain a tool to the allowed scope
   */
  private constrainToScope(tool: MCPTool): MCPTool {
    const result = JSON.parse(JSON.stringify(tool)) as MCPTool;

    // Find path-related properties and add pattern constraints
    if (result.inputSchema.properties) {
      for (const [propName, prop] of Object.entries(result.inputSchema.properties)) {
        if (this.isPathProperty(propName, prop)) {
          // Add pattern to constrain to project dir
          const pathProp = prop as MCPToolProperty;
          pathProp.pattern = this.buildScopePattern();

          // REPLACE-NEVER-APPEND: rewrite description
          pathProp.description = `Path within project directory (${this.config.projectDir})`;
        }
      }
    }

    // REPLACE-NEVER-APPEND: update tool description
    if (result.description) {
      result.description = result.description
        .replace(/any (file|path|directory)/gi, 'files within project directory')
        .replace(/the filesystem/gi, 'the project directory');
    }

    return result;
  }

  /**
   * Build regex pattern for scope constraint
   */
  private buildScopePattern(): string {
    // Allow relative paths within project or explicit allowed paths
    const allowedPatterns = [
      '^\\.\\/', // ./anything (relative paths)
      '^\\.\\.\\/[^/]+', // ../sibling (one level up)
      ...this.config.allowedPaths.map((p) => `^${this.escapeRegex(p)}`),
    ];

    if (this.config.projectDir) {
      allowedPatterns.push(`^${this.escapeRegex(this.config.projectDir)}`);
    }

    // Also allow /tmp for temp files
    allowedPatterns.push('^/tmp/');

    return `(${allowedPatterns.join('|')})`;
  }

  /**
   * Escape special regex characters
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Check if a property is path-related
   */
  private isPathProperty(name: string, prop: MCPToolProperty): boolean {
    const pathNames = ['path', 'file', 'filename', 'filepath', 'directory', 'dir', 'location'];
    const nameLower = name.toLowerCase();

    if (pathNames.some((n) => nameLower.includes(n))) {
      return true;
    }

    // Check description
    const desc = prop.description?.toLowerCase() || '';
    if (desc.includes('path') || desc.includes('file') || desc.includes('directory')) {
      return true;
    }

    return false;
  }

  /**
   * Check if tool is a command execution tool
   */
  private isCommandTool(tool: MCPTool): boolean {
    const commandNames = ['execute', 'run', 'shell', 'bash', 'command', 'exec'];
    const nameLower = tool.name.toLowerCase();

    return commandNames.some((n) => nameLower.includes(n));
  }

  /**
   * Check if tool performs write operations
   */
  private isWriteOperation(tool: MCPTool): boolean {
    const writePatterns = ['write', 'create', 'delete', 'remove', 'update', 'modify', 'execute', 'run'];
    const nameLower = tool.name.toLowerCase();
    const descLower = tool.description?.toLowerCase() || '';

    return writePatterns.some((p) => nameLower.includes(p) || descLower.includes(p));
  }

  /**
   * Infer tool category from name and schema
   */
  private inferCategory(tool: MCPTool): ToolCategory {
    const name = tool.name.toLowerCase();
    const desc = tool.description?.toLowerCase() || '';

    // Check for category patterns
    if (name.includes('file') || name.includes('read_file') || name.includes('write_file')) {
      return 'filesystem';
    }
    if (name.includes('execute') || name.includes('run') || name.includes('shell')) {
      return 'terminal';
    }
    if (name.includes('git')) {
      return 'git';
    }
    if (name.includes('fetch') || name.includes('http') || name.includes('request')) {
      return 'network';
    }
    if (name.includes('query') || name.includes('sql') || desc.includes('database')) {
      return 'database';
    }
    if (name.includes('payment') || name.includes('transfer') || name.includes('stripe')) {
      return 'financial';
    }
    if (name.includes('email') || name.includes('slack') || name.includes('message')) {
      return 'communication';
    }

    return 'unknown';
  }

  /**
   * Check if a command matches hardcoded blocked patterns
   */
  static isBlockedCommand(command: string): boolean {
    for (const pattern of HARDCODED_BLOCKED_COMMANDS) {
      if (pattern.test(command)) {
        return true;
      }
    }
    return false;
  }
}

/**
 * Create ATSP config from loaded configuration
 */
export function createATSPConfig(
  preset: string,
  knobs: Record<string, KnobValue>,
  projectDir: string = process.cwd()
): ATSPConfig {
  // Default levels based on preset
  const presetLevels: Record<string, Partial<Record<ToolCategory, CapabilityLevel>>> = {
    yolo: {
      filesystem: 'full_access',
      terminal: 'full_access',
      git: 'full_access',
      network: 'full_access',
      database: 'full_access',
    },
    coding: {
      filesystem: 'scoped_write',
      terminal: 'scoped_write',
      git: 'scoped_write',
      network: 'full_access',
      database: 'scoped_write',
    },
    personal: {
      filesystem: 'scoped_write',
      terminal: 'disabled',
      git: 'disabled',
      network: 'full_access',
      database: 'read_only',
    },
    trading: {
      filesystem: 'read_only',
      terminal: 'disabled',
      git: 'disabled',
      network: 'scoped_write',
      database: 'read_only',
      financial: 'scoped_write',
    },
    strict: {
      filesystem: 'read_only',
      terminal: 'disabled',
      git: 'disabled',
      network: 'read_only',
      database: 'read_only',
      financial: 'disabled',
    },
  };

  return {
    levels: presetLevels[preset] || presetLevels.coding || {},
    projectDir,
    allowedPaths: [],
    knobs,
  };
}
