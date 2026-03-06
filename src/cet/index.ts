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
    scope_from: 'file_path',
    category: 'filesystem',
    risk: 'low',
  },
  'Write': {
    action: 'write',
    scope_from: 'file_path',
    category: 'filesystem',
    risk_from_scope: true,
  },
  'Edit': {
    action: 'write',
    scope_from: 'file_path',
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
    scope_from: 'target_file',
    category: 'filesystem',
    risk_from_scope: true,
  },
  'read_file': {
    action: 'read',
    scope_from: 'target_file',
    category: 'filesystem',
    risk: 'low',
  },
  'delete_file': {
    action: 'delete',
    scope_from: 'target_file',
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
   * Every Bash tool call goes through this to get a proper risk level
   * instead of the blanket 'critical' from the registry entry.
   */
  private refineTerminalCommand(
    cmd: string
  ): { category: ToolCategory; action: ToolAction; risk?: RiskLevel } | null {
    const trimmed = cmd.trim();
    // Handle piped commands — classify by the most dangerous segment
    if (trimmed.includes('|')) {
      return this.refinePipedCommand(trimmed);
    }
    // Handle chained commands (&&, ;) — classify by the most dangerous segment
    if (/\s*(?:&&|;)\s*/.test(trimmed)) {
      return this.refineChainedCommand(trimmed);
    }
    return this.refineSingleCommand(trimmed);
  }

  /**
   * Classify a piped command by its most dangerous segment.
   * e.g. "curl url | bash" → critical (because of bash)
   */
  private refinePipedCommand(
    cmd: string
  ): { category: ToolCategory; action: ToolAction; risk?: RiskLevel } | null {
    const segments = cmd.split('|').map(s => s.trim());
    const riskOrder: RiskLevel[] = ['low', 'medium', 'high', 'critical'];
    let worst: { category: ToolCategory; action: ToolAction; risk?: RiskLevel } | null = null;
    let worstIdx = -1;

    for (const seg of segments) {
      const result = this.refineSingleCommand(seg);
      if (result) {
        const idx = riskOrder.indexOf(result.risk || 'medium');
        if (idx > worstIdx) {
          worstIdx = idx;
          worst = result;
        }
      }
    }

    // Special case: piping into bash/sh is always critical
    const lastSeg = segments[segments.length - 1]?.split(/\s+/)[0]?.replace(/^.*\//, '');
    if (lastSeg === 'bash' || lastSeg === 'sh' || lastSeg === 'zsh') {
      return { category: 'terminal', action: 'execute', risk: 'critical' };
    }

    return worst;
  }

  /**
   * Classify chained commands (&&, ;) by the most dangerous segment.
   */
  private refineChainedCommand(
    cmd: string
  ): { category: ToolCategory; action: ToolAction; risk?: RiskLevel } | null {
    const segments = cmd.split(/\s*(?:&&|;)\s*/).map(s => s.trim()).filter(Boolean);
    const riskOrder: RiskLevel[] = ['low', 'medium', 'high', 'critical'];
    let worst: { category: ToolCategory; action: ToolAction; risk?: RiskLevel } | null = null;
    let worstIdx = -1;

    for (const seg of segments) {
      // Each segment might itself be piped
      const result = seg.includes('|')
        ? this.refinePipedCommand(seg)
        : this.refineSingleCommand(seg);
      if (result) {
        const idx = riskOrder.indexOf(result.risk || 'medium');
        if (idx > worstIdx) {
          worstIdx = idx;
          worst = result;
        }
      }
    }
    return worst;
  }

  /**
   * Classify a single (non-piped, non-chained) command.
   */
  private refineSingleCommand(
    cmd: string
  ): { category: ToolCategory; action: ToolAction; risk?: RiskLevel } | null {
    const trimmed = cmd.trim();
    const words = trimmed.split(/\s+/);
    const firstWord = words[0]?.replace(/^.*\//, ''); // strip path prefix

    if (!firstWord) return { category: 'terminal', action: 'read', risk: 'low' };

    // ── Critical: genuinely catastrophic ──
    if (firstWord === 'sudo') {
      return { category: 'terminal', action: 'execute', risk: 'critical' };
    }
    if (firstWord === 'dd') {
      return { category: 'filesystem', action: 'write', risk: 'critical' };
    }
    if (firstWord === 'mkfs' || firstWord === 'fdisk' || firstWord === 'parted') {
      return { category: 'filesystem', action: 'delete', risk: 'critical' };
    }
    // eval/exec/source can run arbitrary code
    if (firstWord === 'eval') {
      return { category: 'terminal', action: 'execute', risk: 'critical' };
    }
    if (firstWord === 'exec') {
      return { category: 'terminal', action: 'execute', risk: 'high' };
    }
    if (firstWord === 'source' || firstWord === '.') {
      return { category: 'terminal', action: 'execute', risk: 'high' };
    }
    // nohup just wraps another command — classify by the inner command
    if (firstWord === 'nohup' && words[1]) {
      const inner = trimmed.replace(/^nohup\s+/, '');
      return this.refineSingleCommand(inner) || { category: 'terminal', action: 'execute', risk: 'medium' };
    }

    // ── find with destructive flags ──
    if (firstWord === 'find') {
      if (trimmed.includes('-delete') || trimmed.includes('-exec') || trimmed.includes('-execdir')) {
        return { category: 'terminal', action: 'delete', risk: 'high' };
      }
      return { category: 'terminal', action: 'read', risk: 'low' };
    }

    // ── File deletion — risk depends on flags ──
    if (firstWord === 'rm' || firstWord === 'rmdir' || firstWord === 'unlink') {
      // rm -rf, rm -r, rm --recursive, or wildcards → terminal/delete → destructive_commands knob (block)
      if (/\s-\S*r/i.test(trimmed) || trimmed.includes('--recursive') || trimmed.includes('*')) {
        return { category: 'terminal', action: 'delete', risk: 'high' };
      }
      // rm <specific file> → filesystem/delete → file_delete knob (approve prompt)
      return { category: 'filesystem', action: 'delete', risk: 'medium' };
    }

    // ── Git operations ──
    if (firstWord === 'git') {
      const subCmd = words[1];
      if (subCmd === 'push' && (trimmed.includes('--force') || trimmed.includes('-f'))) {
        return { category: 'git', action: 'execute', risk: 'critical' };
      }
      if (subCmd === 'push') return { category: 'git', action: 'transfer', risk: 'medium' };
      if (subCmd === 'branch' && trimmed.includes('-D')) return { category: 'git', action: 'delete', risk: 'high' };
      if (subCmd === 'reset' && trimmed.includes('--hard')) return { category: 'git', action: 'delete', risk: 'high' };
      if (subCmd === 'clean' && trimmed.includes('-f')) return { category: 'git', action: 'delete', risk: 'high' };
      if (subCmd === 'rebase') return { category: 'git', action: 'write', risk: 'medium' };
      // Safe git: status, log, diff, show, branch (list), stash list, add, commit, fetch, pull, checkout
      return { category: 'git', action: 'read', risk: 'low' };
    }

    // ── Package managers ──
    if (firstWord === 'npm' || firstWord === 'yarn' || firstWord === 'pnpm' || firstWord === 'pip' || firstWord === 'pip3' || firstWord === 'bun') {
      const subCmd = words[1];
      if (subCmd === 'install' || subCmd === 'add' || subCmd === 'i' || subCmd === 'ci') {
        return { category: 'package', action: 'create', risk: 'medium' };
      }
      if (subCmd === 'uninstall' || subCmd === 'remove' || subCmd === 'rm') {
        return { category: 'package', action: 'delete', risk: 'medium' };
      }
      // npm run, npm test, npm start, npx, etc. → medium (runs scripts)
      return { category: 'terminal', action: 'execute', risk: 'medium' };
    }
    if (firstWord === 'npx') {
      return { category: 'terminal', action: 'execute', risk: 'medium' };
    }
    // System package managers
    if (firstWord === 'apt' || firstWord === 'apt-get' || firstWord === 'brew' || firstWord === 'dnf' || firstWord === 'yum' || firstWord === 'pacman' || firstWord === 'apk') {
      const subCmd = words[1];
      if (subCmd === 'install' || subCmd === 'add' || subCmd === '-S') {
        return { category: 'package', action: 'create', risk: 'medium' };
      }
      if (subCmd === 'remove' || subCmd === 'uninstall' || subCmd === 'purge' || subCmd === '-R') {
        return { category: 'package', action: 'delete', risk: 'medium' };
      }
      if (subCmd === 'update' || subCmd === 'upgrade') {
        return { category: 'package', action: 'write', risk: 'medium' };
      }
      return { category: 'package', action: 'read', risk: 'low' };
    }

    // ── Language-specific package managers ──
    if (firstWord === 'cargo') {
      const subCmd = words[1];
      if (subCmd === 'add' || subCmd === 'install') return { category: 'package', action: 'create', risk: 'medium' };
      if (subCmd === 'remove' || subCmd === 'uninstall') return { category: 'package', action: 'delete', risk: 'medium' };
      return { category: 'terminal', action: 'execute', risk: 'medium' };
    }
    if (firstWord === 'go') {
      const subCmd = words[1];
      if (subCmd === 'get' || subCmd === 'install') return { category: 'package', action: 'create', risk: 'medium' };
      return { category: 'terminal', action: 'execute', risk: 'medium' };
    }
    if (firstWord === 'gem') {
      const subCmd = words[1];
      if (subCmd === 'install') return { category: 'package', action: 'create', risk: 'medium' };
      if (subCmd === 'uninstall') return { category: 'package', action: 'delete', risk: 'medium' };
      return { category: 'package', action: 'read', risk: 'low' };
    }
    if (firstWord === 'composer') {
      const subCmd = words[1];
      if (subCmd === 'require' || subCmd === 'install') return { category: 'package', action: 'create', risk: 'medium' };
      if (subCmd === 'remove') return { category: 'package', action: 'delete', risk: 'medium' };
      return { category: 'terminal', action: 'execute', risk: 'medium' };
    }
    if (firstWord === 'dotnet') {
      if (words[1] === 'add' && words[2] === 'package') return { category: 'package', action: 'create', risk: 'medium' };
      return { category: 'terminal', action: 'execute', risk: 'medium' };
    }

    // ── Network commands ──
    if (firstWord === 'curl' || firstWord === 'wget') {
      return { category: 'network', action: 'read', risk: 'medium' };
    }

    // ── Remote access ──
    if (firstWord === 'ssh') {
      return { category: 'network', action: 'execute', risk: 'high' };
    }
    if (firstWord === 'scp' || firstWord === 'rsync') {
      return { category: 'network', action: 'write', risk: 'medium' };
    }

    // ── Scheduling ──
    if (firstWord === 'crontab') {
      if (trimmed.includes('-r') || trimmed.includes('-i')) return { category: 'scheduling', action: 'delete', risk: 'high' };
      if (trimmed.includes('-l')) return { category: 'scheduling', action: 'read', risk: 'low' };
      if (trimmed.includes('-e')) return { category: 'scheduling', action: 'write', risk: 'medium' };
      return { category: 'scheduling', action: 'read', risk: 'low' };
    }
    if (firstWord === 'at') {
      return { category: 'scheduling', action: 'create', risk: 'medium' };
    }

    // ── Script runners → medium ──
    if (firstWord === 'node' || firstWord === 'python' || firstWord === 'python3' ||
        firstWord === 'ruby' || firstWord === 'perl' || firstWord === 'deno' || firstWord === 'bun') {
      return { category: 'terminal', action: 'execute', risk: 'medium' };
    }

    // ── Permission/ownership changes → high ──
    if (firstWord === 'chmod' || firstWord === 'chown' || firstWord === 'chgrp') {
      return { category: 'filesystem', action: 'execute', risk: 'high' };
    }

    // ── File write operations → medium ──
    if (firstWord === 'mv' || firstWord === 'cp') {
      return { category: 'filesystem', action: 'write', risk: 'medium' };
    }
    if (firstWord === 'mkdir' || firstWord === 'touch') {
      return { category: 'filesystem', action: 'create', risk: 'low' };
    }
    if (firstWord === 'sed' || firstWord === 'awk') {
      // In-place edit flag (-i) → medium, otherwise read
      if (trimmed.includes(' -i')) return { category: 'filesystem', action: 'write', risk: 'medium' };
      return { category: 'filesystem', action: 'read', risk: 'low' };
    }
    if (firstWord === 'tee') {
      return { category: 'filesystem', action: 'write', risk: 'medium' };
    }

    // ── Read-only / informational commands → low ──
    const readOnlyCommands = new Set([
      'echo', 'printf', 'ls', 'dir', 'pwd', 'cat', 'head', 'tail', 'less', 'more',
      'grep', 'rg', 'ag', 'ack', 'fd', 'which', 'where', 'type', 'command',
      'cd', 'wc', 'sort', 'uniq', 'diff', 'tr', 'cut', 'env', 'printenv', 'export',
      'date', 'whoami', 'hostname', 'uname', 'id', 'groups', 'file', 'stat', 'du', 'df',
      'test', '[', 'true', 'false', 'seq', 'yes', 'basename', 'dirname', 'realpath',
      'readlink', 'md5sum', 'sha256sum', 'sha1sum', 'base64', 'xxd', 'od', 'hexdump',
      'man', 'help', 'info', 'bat', 'jq', 'yq', 'xargs',
      'safemode',
    ]);
    if (readOnlyCommands.has(firstWord)) {
      // Output redirection overrides read → write
      if (/\s>{1,2}\s*\S/.test(trimmed)) {
        return { category: 'filesystem', action: 'write', risk: 'medium' };
      }
      return { category: 'terminal', action: 'read', risk: 'low' };
    }

    // ── Docker — differentiate by subcommand ──
    if (firstWord === 'docker' || firstWord === 'podman') {
      const subCmd = words[1];
      if (subCmd === 'run' || subCmd === 'exec') return { category: 'container', action: 'execute', risk: 'high' };
      if (subCmd === 'rm' || subCmd === 'rmi' || subCmd === 'prune') return { category: 'container', action: 'delete', risk: 'high' };
      if (subCmd === 'build' || subCmd === 'compose') return { category: 'container', action: 'create', risk: 'medium' };
      if (subCmd === 'pull') return { category: 'container', action: 'read', risk: 'low' };
      if (subCmd === 'ps' || subCmd === 'images' || subCmd === 'inspect' || subCmd === 'logs') return { category: 'container', action: 'read', risk: 'low' };
      if (subCmd === 'push') return { category: 'container', action: 'write', risk: 'medium' };
      return { category: 'container', action: 'execute', risk: 'medium' };
    }

    // ── Kubernetes — differentiate by subcommand ──
    if (firstWord === 'kubectl') {
      const subCmd = words[1];
      if (subCmd === 'delete') return { category: 'cloud', action: 'delete', risk: 'high' };
      if (subCmd === 'apply' || subCmd === 'create' || subCmd === 'patch' || subCmd === 'replace') return { category: 'cloud', action: 'write', risk: 'medium' };
      if (subCmd === 'exec') return { category: 'container', action: 'execute', risk: 'high' };
      if (subCmd === 'get' || subCmd === 'describe' || subCmd === 'logs' || subCmd === 'top') return { category: 'cloud', action: 'read', risk: 'low' };
      return { category: 'cloud', action: 'read', risk: 'medium' };
    }

    // ── Terraform — differentiate by subcommand ──
    if (firstWord === 'terraform' || firstWord === 'tofu') {
      const subCmd = words[1];
      if (subCmd === 'destroy') return { category: 'cloud', action: 'delete', risk: 'critical' };
      if (subCmd === 'apply') return { category: 'cloud', action: 'write', risk: 'high' };
      if (subCmd === 'plan' || subCmd === 'init' || subCmd === 'validate' || subCmd === 'fmt') return { category: 'cloud', action: 'read', risk: 'low' };
      return { category: 'cloud', action: 'read', risk: 'medium' };
    }

    // ── Build tools → medium ──
    const buildTools = new Set([
      'make', 'cmake', 'rustc', 'gcc', 'g++', 'clang', 'javac',
      'tsc', 'esbuild', 'webpack', 'vite', 'rollup', 'turbo', 'nx',
    ]);
    if (buildTools.has(firstWord)) {
      return { category: 'terminal', action: 'execute', risk: 'medium' };
    }

    // ── Default: unrecognized commands → medium (not critical) ──
    return { category: 'terminal', action: 'execute', risk: 'medium' };
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

    // Project scope takes priority — if the path is within the project dir, it's project
    if (this.projectDir && pathStr.startsWith(this.projectDir)) {
      return 'project';
    }

    // Relative paths are project scope (but not ~ which is user home)
    if (!pathStr.startsWith('~') && (pathStr.startsWith('./') || pathStr.startsWith('../') || !pathStr.startsWith('/'))) {
      return 'project';
    }

    // System scope
    const systemPaths = ['/etc', '/usr', '/var', '/sys', '/bin', '/sbin', '/lib', '/tmp'];
    for (const sys of systemPaths) {
      if (pathStr.startsWith(sys)) {
        return 'system';
      }
    }

    // User home scope
    if (pathStr.startsWith('~') || pathStr.startsWith('/home/') || pathStr.startsWith('/Users/')) {
      return 'user_home';
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
