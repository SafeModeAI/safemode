/**
 * CET (Constrained Execution Tools) Classifier
 *
 * Decomposes every tool call into a structured ToolCallEffect:
 * - action: what the tool does (read, write, delete, execute, etc.)
 * - target: what it operates on (file path, URL, table name)
 * - scope: where (project, user_home, system, network, financial)
 * - risk: computed risk level
 * - category: for knob mapping
 */

import {
  type ToolCallEffect,
  type ToolAction,
  type ToolScope,
  type ToolCategory,
  type RiskLevel,
  type KnownToolRegistry,
  type KnownToolEntry,
  getRiskFromMatrix,
} from './types.js';

// ============================================================================
// Known Tool Registry (L1)
// ============================================================================

const KNOWN_TOOLS: KnownToolRegistry = {
  // Filesystem tools
  '@modelcontextprotocol/server-filesystem:read_file': {
    action: 'read',
    scope_from: 'parameters.path',
    category: 'filesystem',
    risk: 'low',
  },
  '@modelcontextprotocol/server-filesystem:write_file': {
    action: 'write',
    scope_from: 'parameters.path',
    category: 'filesystem',
    risk_from_scope: true,
  },
  '@modelcontextprotocol/server-filesystem:list_directory': {
    action: 'list',
    scope_from: 'parameters.path',
    category: 'filesystem',
    risk: 'low',
  },
  '@modelcontextprotocol/server-filesystem:create_directory': {
    action: 'create',
    scope_from: 'parameters.path',
    category: 'filesystem',
    risk_from_scope: true,
  },
  '@modelcontextprotocol/server-filesystem:delete_file': {
    action: 'delete',
    scope_from: 'parameters.path',
    category: 'filesystem',
    risk_from_scope: true,
  },
  '@modelcontextprotocol/server-filesystem:move_file': {
    action: 'write',
    scope_from: 'parameters.source',
    category: 'filesystem',
    risk_from_scope: true,
  },
  '@modelcontextprotocol/server-filesystem:search_files': {
    action: 'search',
    scope_from: 'parameters.path',
    category: 'filesystem',
    risk: 'low',
  },

  // Fetch/network tools
  '@anthropic/mcp-server-fetch:fetch': {
    action: 'read',
    scope: 'network',
    category: 'network',
    risk: 'low',
  },

  // Git tools
  '@modelcontextprotocol/server-git:git_status': {
    action: 'read',
    scope: 'project',
    category: 'git',
    risk: 'low',
  },
  '@modelcontextprotocol/server-git:git_commit': {
    action: 'write',
    scope: 'project',
    category: 'git',
    risk: 'low',
  },
  '@modelcontextprotocol/server-git:git_push': {
    action: 'write',
    scope: 'network',
    category: 'git',
    risk: 'medium',
  },

  // Terminal tools
  'terminal:execute': {
    action: 'execute',
    scope: 'system',
    category: 'terminal',
    risk: 'critical',
  },
  'bash:run': {
    action: 'execute',
    scope: 'system',
    category: 'terminal',
    risk: 'critical',
  },

  // Claude Code native tool names
  'Bash': {
    action: 'execute',
    scope: 'system',
    category: 'terminal',
    risk: 'critical',
  },
  'Read': {
    action: 'read',
    scope_from: 'parameters.file_path',
    category: 'filesystem',
    risk: 'low',
  },
  'Write': {
    action: 'write',
    scope_from: 'parameters.file_path',
    category: 'filesystem',
    risk_from_scope: true,
  },
  'Edit': {
    action: 'write',
    scope_from: 'parameters.file_path',
    category: 'filesystem',
    risk_from_scope: true,
  },
  'Glob': {
    action: 'search',
    category: 'filesystem',
    risk: 'low',
  },
  'Grep': {
    action: 'search',
    category: 'filesystem',
    risk: 'low',
  },

  // Cursor tool names
  'run_terminal_command': {
    action: 'execute',
    scope: 'system',
    category: 'terminal',
    risk: 'critical',
  },
  'edit_file': {
    action: 'write',
    scope_from: 'parameters.target_file',
    category: 'filesystem',
    risk_from_scope: true,
  },
  'read_file': {
    action: 'read',
    scope_from: 'parameters.target_file',
    category: 'filesystem',
    risk: 'low',
  },
  'delete_file': {
    action: 'delete',
    scope_from: 'parameters.target_file',
    category: 'filesystem',
    risk_from_scope: true,
  },
};

// ============================================================================
// Schema Inference Patterns (L2)
// ============================================================================

const PARAMETER_PATTERNS: Record<string, { category: ToolCategory; scopeHint?: ToolScope }> = {
  path: { category: 'filesystem' },
  file: { category: 'filesystem' },
  filename: { category: 'filesystem' },
  filepath: { category: 'filesystem' },
  directory: { category: 'filesystem' },
  dir: { category: 'filesystem' },
  query: { category: 'database' },
  sql: { category: 'database' },
  url: { category: 'network', scopeHint: 'network' },
  endpoint: { category: 'network', scopeHint: 'network' },
  command: { category: 'terminal', scopeHint: 'system' },
  cmd: { category: 'terminal', scopeHint: 'system' },
  shell: { category: 'terminal', scopeHint: 'system' },
  amount: { category: 'financial', scopeHint: 'financial' },
  price: { category: 'financial', scopeHint: 'financial' },
  payment: { category: 'financial', scopeHint: 'financial' },
};

const ACTION_PATTERNS: Record<string, ToolAction> = {
  read: 'read',
  get: 'read',
  fetch: 'read',
  list: 'list',
  search: 'search',
  find: 'search',
  write: 'write',
  create: 'create',
  add: 'create',
  insert: 'create',
  update: 'write',
  modify: 'write',
  delete: 'delete',
  remove: 'delete',
  drop: 'delete',
  execute: 'execute',
  run: 'execute',
  exec: 'execute',
  transfer: 'transfer',
  send: 'transfer',
};

// ============================================================================
// CET Classifier
// ============================================================================

export class CETClassifier {
  private registry: KnownToolRegistry;
  private projectDir: string;

  constructor(projectDir: string = process.cwd()) {
    this.registry = KNOWN_TOOLS;
    this.projectDir = projectDir;
  }

  /**
   * Classify a tool call
   */
  classify(
    toolName: string,
    params: Record<string, unknown>,
    serverName?: string
  ): ToolCallEffect {
    // Try L1: Known Tool Registry
    const registryKey = serverName ? `${serverName}:${toolName}` : toolName;
    const entry = this.registry[registryKey];

    if (entry) {
      return this.classifyFromRegistry(entry, params);
    }

    // Fall back to L2: Schema Inference
    return this.classifyFromInference(toolName, params);
  }

  /**
   * Classify from registry entry (L1)
   */
  private classifyFromRegistry(
    entry: KnownToolEntry,
    params: Record<string, unknown>
  ): ToolCallEffect {
    // Get action
    let action: ToolAction = entry.action || 'read';
    if (entry.action_from) {
      const actionValue = this.getNestedValue(params, entry.action_from);
      if (typeof actionValue === 'string') {
        action = this.inferActionFromValue(actionValue);
      }
    }

    // Get scope
    let scope: ToolScope = entry.scope || 'project';
    if (entry.scope_from) {
      const target = this.getNestedValue(params, entry.scope_from);
      if (typeof target === 'string') {
        scope = this.inferScopeFromPath(target);
      }
    }

    // Get risk
    let risk: RiskLevel;
    if (entry.risk) {
      risk = entry.risk;
    } else if (entry.risk_from_scope || entry.risk_from_action) {
      risk = getRiskFromMatrix(action, scope);
    } else {
      risk = 'low';
    }

    // Get target
    const target = entry.scope_from
      ? String(this.getNestedValue(params, entry.scope_from) || '')
      : '';

    let category = entry.category;

    // Refine terminal commands by analyzing command content
    if (category === 'terminal' && action === 'execute') {
      const cmd = String(params.command || params.cmd || '');
      const refined = this.refineTerminalCommand(cmd);
      if (refined) {
        category = refined.category;
        action = refined.action;
        risk = refined.risk || risk;
      }
    }

    return {
      action,
      target,
      scope,
      risk,
      category,
      confidence: 1.0,
      source: 'registry',
    };
  }

  /**
   * Analyze a shell command string and refine its classification.
   * Reclassifies destructive commands (rm, chmod, etc.) as filesystem/delete
   * so that knob gate file_delete and destructive_commands knobs apply.
   */
  private refineTerminalCommand(
    cmd: string
  ): { category: ToolCategory; action: ToolAction; risk?: RiskLevel } | null {
    const trimmed = cmd.trim();
    const firstWord = trimmed.split(/\s+/)[0]?.replace(/^.*\//, ''); // strip path prefix

    // File deletion commands → filesystem/delete
    if (firstWord === 'rm' || firstWord === 'rmdir' || firstWord === 'unlink') {
      return { category: 'filesystem', action: 'delete', risk: 'critical' };
    }

    // Git operations — only reclassify dangerous ones
    if (firstWord === 'git') {
      const subCmd = trimmed.split(/\s+/)[1];
      if (subCmd === 'push' && trimmed.includes('--force')) return { category: 'git', action: 'delete', risk: 'critical' };
      if (subCmd === 'push') return { category: 'git', action: 'write', risk: 'medium' };
      if (subCmd === 'branch' && trimmed.includes('-D')) return { category: 'git', action: 'delete', risk: 'high' };
      if (subCmd === 'reset' && trimmed.includes('--hard')) return { category: 'git', action: 'delete', risk: 'high' };
      // Safe git operations (add, commit, status, diff, log, etc.) — don't reclassify
      return null;
    }

    // Package installs → package category
    if (firstWord === 'npm' || firstWord === 'yarn' || firstWord === 'pnpm' || firstWord === 'pip' || firstWord === 'pip3') {
      const subCmd = trimmed.split(/\s+/)[1];
      if (subCmd === 'install' || subCmd === 'add' || subCmd === 'i') {
        return { category: 'package', action: 'create', risk: 'medium' };
      }
      if (subCmd === 'uninstall' || subCmd === 'remove' || subCmd === 'rm') {
        return { category: 'package', action: 'delete', risk: 'medium' };
      }
    }

    // Network commands → network category
    if (firstWord === 'curl' || firstWord === 'wget') {
      return { category: 'network', action: 'read', risk: 'medium' };
    }

    return null;
  }

  /**
   * Classify from inference (L2)
   */
  private classifyFromInference(
    toolName: string,
    params: Record<string, unknown>
  ): ToolCallEffect {
    // Infer category from parameters
    let category: ToolCategory = 'unknown';
    let scopeHint: ToolScope | undefined;
    let target = '';

    for (const [paramName, _paramValue] of Object.entries(params)) {
      const nameLower = paramName.toLowerCase();
      for (const [pattern, info] of Object.entries(PARAMETER_PATTERNS)) {
        if (nameLower.includes(pattern)) {
          category = info.category;
          scopeHint = info.scopeHint;
          target = String(_paramValue);
          break;
        }
      }
      if (category !== 'unknown') break;
    }

    // Infer action from tool name
    const action = this.inferActionFromName(toolName);

    // Infer scope from target or hint
    let scope: ToolScope = scopeHint || 'project';
    if (target && category === 'filesystem') {
      scope = this.inferScopeFromPath(target);
    }

    // Compute risk
    const risk = getRiskFromMatrix(action, scope);

    return {
      action,
      target,
      scope,
      risk,
      category,
      confidence: 0.85, // L2 has ~85% accuracy
      source: 'inference',
    };
  }

  /**
   * Infer action from tool name
   */
  private inferActionFromName(toolName: string): ToolAction {
    const nameLower = toolName.toLowerCase();

    for (const [pattern, action] of Object.entries(ACTION_PATTERNS)) {
      if (nameLower.includes(pattern)) {
        return action;
      }
    }

    // Default to read for unknown
    return 'read';
  }

  /**
   * Infer action from a value (e.g., SQL query)
   */
  private inferActionFromValue(value: string): ToolAction {
    const valueLower = value.toLowerCase().trim();

    // SQL patterns
    if (/^select\b/i.test(valueLower)) return 'read';
    if (/^insert\b/i.test(valueLower)) return 'create';
    if (/^update\b/i.test(valueLower)) return 'write';
    if (/^delete\b/i.test(valueLower)) return 'delete';
    if (/^drop\b/i.test(valueLower)) return 'delete';
    if (/^create\b/i.test(valueLower)) return 'create';
    if (/^alter\b/i.test(valueLower)) return 'write';

    return 'execute';
  }

  /**
   * Infer scope from file path
   */
  private inferScopeFromPath(pathStr: string): ToolScope {
    // Network scope
    if (/^https?:\/\//i.test(pathStr)) {
      return 'network';
    }

    // System scope
    const systemPaths = ['/etc', '/usr', '/var', '/sys', '/bin', '/sbin', '/lib'];
    for (const sys of systemPaths) {
      if (pathStr.startsWith(sys)) {
        return 'system';
      }
    }

    // User home scope
    if (pathStr.startsWith('~') || pathStr.startsWith('/home/') || pathStr.startsWith('/Users/')) {
      // Check if within project
      if (this.projectDir && pathStr.startsWith(this.projectDir)) {
        return 'project';
      }
      return 'user_home';
    }

    // Relative paths are project scope
    if (pathStr.startsWith('./') || pathStr.startsWith('../') || !pathStr.startsWith('/')) {
      return 'project';
    }

    // Check if within project directory
    if (this.projectDir && pathStr.startsWith(this.projectDir)) {
      return 'project';
    }

    // Default to user_home for absolute paths not matching other patterns
    return 'user_home';
  }

  /**
   * Get nested value from object using dot notation
   */
  private getNestedValue(obj: Record<string, unknown>, path: string): unknown {
    const parts = path.split('.');
    let current: unknown = obj;

    for (const part of parts) {
      if (current === null || current === undefined) return undefined;
      if (typeof current !== 'object') return undefined;
      current = (current as Record<string, unknown>)[part];
    }

    return current;
  }

  /**
   * Add custom tool to registry
   */
  addTool(key: string, entry: KnownToolEntry): void {
    this.registry[key] = entry;
  }
}
