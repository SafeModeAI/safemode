/**
 * Engine 13: Command Firewall
 *
 * Blocks dangerous shell commands. HARDCODED - cannot be disabled.
 * rm -rf /, mkfs, fork bombs, curl|sh, etc.
 */

import type { DetectionEngine, EngineResult, EngineContext } from './base.js';

// ============================================================================
// Blocked Command Patterns
// ============================================================================

interface CommandPattern {
  pattern: RegExp;
  name: string;
  description: string;
}

const BLOCKED_PATTERNS: CommandPattern[] = [
  // Disk destruction
  {
    pattern: /rm\s+(-[a-zA-Z]*r[a-zA-Z]*\s+)?(-[a-zA-Z]*f[a-zA-Z]*\s+)?\/(\s|$|;|\|)/i,
    name: 'rm_root',
    description: 'rm -rf / (disk wipe)',
  },
  {
    pattern: /rm\s+(-[a-zA-Z]*r[a-zA-Z]*\s+)?(-[a-zA-Z]*f[a-zA-Z]*\s+)?\/(usr|var|etc|bin|sbin|lib|boot|sys|proc|dev)(\/|\s|$|;|\|)/i,
    name: 'rm_system_dir',
    description: 'rm -rf on system directory',
  },
  {
    pattern: /rm\s+(-[a-zA-Z]*r[a-zA-Z]*\s+)?(-[a-zA-Z]*f[a-zA-Z]*\s+)?\/\*/i,
    name: 'rm_root_glob',
    description: 'rm -rf /* (disk wipe)',
  },
  {
    pattern: /rm\s+(-[a-zA-Z]*r[a-zA-Z]*\s+)?(-[a-zA-Z]*f[a-zA-Z]*\s+)?~\//i,
    name: 'rm_home',
    description: 'rm -rf ~/ (home directory wipe)',
  },
  {
    pattern: /mkfs(\.[a-z0-9]+)?\s+/i,
    name: 'mkfs',
    description: 'mkfs (format filesystem)',
  },
  {
    pattern: /dd\s+.*if=\/dev\/(zero|random|urandom)/i,
    name: 'dd_zero',
    description: 'dd if=/dev/zero (overwrite disk)',
  },
  {
    pattern: /dd\s+.*of=\/dev\/[sh]d[a-z]/i,
    name: 'dd_disk',
    description: 'dd to raw disk device',
  },

  // Fork bombs
  {
    pattern: /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;?\s*:/,
    name: 'fork_bomb_classic',
    description: 'Classic fork bomb :(){ :|:& };:',
  },
  {
    pattern: /\.\s*\|\s*\.\s*&/,
    name: 'fork_bomb_dot',
    description: 'Dot fork bomb',
  },
  {
    pattern: /while\s+true\s*;\s*do\s+.*&\s*done/i,
    name: 'fork_bomb_while',
    description: 'While loop fork bomb',
  },

  // Permission abuse
  {
    pattern: /chmod\s+(-[a-zA-Z]*R[a-zA-Z]*\s+)?777\s+\//i,
    name: 'chmod_777_root',
    description: 'chmod 777 / (insecure permissions)',
  },
  {
    pattern: /chown\s+(-[a-zA-Z]*R[a-zA-Z]*\s+)?\S+:\S+\s+\//i,
    name: 'chown_root',
    description: 'chown -R on root',
  },

  // Raw disk/memory access
  {
    pattern: />\s*\/dev\/sd[a-z]/i,
    name: 'write_disk',
    description: 'Direct write to disk device',
  },
  {
    pattern: />\s*\/dev\/mem/i,
    name: 'write_mem',
    description: 'Direct write to memory',
  },
  {
    pattern: /cat\s+.*>\s*\/dev\/sd[a-z]/i,
    name: 'cat_disk',
    description: 'Cat to disk device',
  },

  // Pipe to shell (ALWAYS blocked)
  {
    pattern: /curl\s+.*\|\s*(bash|sh|zsh|ksh|tcsh)/i,
    name: 'curl_pipe_shell',
    description: 'curl | sh (remote code execution)',
  },
  {
    pattern: /wget\s+.*\|\s*(bash|sh|zsh|ksh|tcsh)/i,
    name: 'wget_pipe_shell',
    description: 'wget | sh (remote code execution)',
  },
  {
    pattern: /\|\s*(bash|sh|zsh)\s*(-[a-zA-Z]+)?\s*$/,
    name: 'pipe_to_shell',
    description: 'Piping to shell',
  },

  // History manipulation
  {
    pattern: /history\s+-c/i,
    name: 'history_clear',
    description: 'Clearing shell history',
  },
  {
    pattern: /rm\s+.*\.(bash_history|zsh_history)/i,
    name: 'history_delete',
    description: 'Deleting shell history',
  },

  // System-critical files
  {
    pattern: />\s*\/etc\/passwd/i,
    name: 'overwrite_passwd',
    description: 'Overwriting /etc/passwd',
  },
  {
    pattern: />\s*\/etc\/shadow/i,
    name: 'overwrite_shadow',
    description: 'Overwriting /etc/shadow',
  },
  {
    pattern: /rm\s+.*\/etc\/passwd/i,
    name: 'delete_passwd',
    description: 'Deleting /etc/passwd',
  },

  // Kernel/boot tampering
  {
    pattern: /rm\s+.*\/boot\//i,
    name: 'delete_boot',
    description: 'Deleting boot files',
  },
  {
    pattern: />\s*\/boot\//i,
    name: 'overwrite_boot',
    description: 'Overwriting boot files',
  },

  // Network attacks (basics)
  {
    pattern: /nc\s+-[a-z]*l[a-z]*\s+-[a-z]*e[a-z]*\s/i,
    name: 'netcat_reverse_shell',
    description: 'Netcat reverse shell',
  },
  {
    pattern: /nc\s+-[a-z]*(?:l[a-z]*e|e[a-z]*l)[a-z]*\s/i,
    name: 'netcat_reverse_shell_combined',
    description: 'Netcat reverse shell (combined flags)',
  },
  {
    pattern: /python[23]?\s+-c\s+.*socket\s*\(/i,
    name: 'python_socket_shell',
    description: 'Python socket shell',
  },

  // Destructive find commands
  {
    pattern: /find\s+\/\s+.*-delete/i,
    name: 'find_root_delete',
    description: 'find / -delete (recursive root deletion)',
  },
  {
    pattern: /find\s+\/\s+.*-exec\s+rm/i,
    name: 'find_root_exec_rm',
    description: 'find / -exec rm (recursive root deletion)',
  },

  // Long-form rm flags
  {
    pattern: /rm\s+--recursive\s+--force\s+\//i,
    name: 'rm_longform_root',
    description: 'rm --recursive --force / (disk wipe)',
  },

  // Eval with dangerous content
  {
    pattern: /eval\s+.*(?:rm\s|mkfs|dd\s|curl.*\|\s*(?:bash|sh))/i,
    name: 'eval_dangerous',
    description: 'eval with dangerous command',
  },

  // Evasion: base64-encoded commands piped to shell
  {
    pattern: /base64\s+(-d|--decode)\s*\|\s*(bash|sh|zsh)/i,
    name: 'base64_pipe_shell',
    description: 'base64 decoded and piped to shell',
  },
  {
    pattern: /\becho\b.*\|\s*base64\s+(-d|--decode)\s*\|\s*(bash|sh|zsh)/i,
    name: 'echo_base64_pipe_shell',
    description: 'echo | base64 -d | bash (encoded command execution)',
  },

  // Evasion: ANSI-C quoting ($'\x72\x6d' = rm)
  {
    pattern: /\$'(\\x[0-9a-f]{2}){2,}'/i,
    name: 'ansi_c_hex_escape',
    description: 'ANSI-C hex escape sequence (possible evasion)',
  },

  // Evasion: xxd/printf decode piped to shell
  {
    pattern: /(?:xxd\s+-r|printf\s+.*\\x)\s*.*\|\s*(bash|sh|zsh)/i,
    name: 'hex_decode_pipe_shell',
    description: 'Hex decode piped to shell (evasion)',
  },

  // Evasion: python/perl -e one-liner executing system commands
  {
    pattern: /python[23]?\s+-c\s+.*(?:os\.system|subprocess\b|exec)\s*[\.(]/i,
    name: 'python_system_exec',
    description: 'Python one-liner executing system commands',
  },
  {
    pattern: /perl\s+-e\s+.*(?:system|exec)\s*\(/i,
    name: 'perl_system_exec',
    description: 'Perl one-liner executing system commands',
  },
];

// ============================================================================
// Command Firewall Engine
// ============================================================================

export class CommandFirewall implements DetectionEngine {
  readonly id = 13;
  readonly name = 'command_firewall';
  readonly description = 'Blocks dangerous shell commands (HARDCODED)';

  async evaluate(context: EngineContext): Promise<EngineResult> {
    const { parameters } = context;

    // Extract command from parameters — check ALL tool calls, not just terminal
    // because CET may reclassify commands (e.g., dd → filesystem, chmod → filesystem)
    const command = this.extractCommand(parameters);
    if (!command) {
      return this.allowResult();
    }

    // Check against blocked patterns
    for (const { pattern, name, description } of BLOCKED_PATTERNS) {
      if (pattern.test(command)) {
        return {
          engine_id: this.id,
          engine_name: this.name,
          detected: true,
          severity: 'critical',
          confidence: 0.99,
          action: 'block',
          details: {
            reason: `HARDCODED BLOCK: ${description}`,
            pattern_name: name,
            command_preview: command.slice(0, 100),
          },
          latency_ms: 0,
        };
      }
    }

    return this.allowResult();
  }

  private extractCommand(params: Record<string, unknown>): string | null {
    // Common parameter names for commands
    const commandKeys = ['command', 'cmd', 'shell', 'script', 'bash', 'exec', 'run'];

    for (const key of commandKeys) {
      if (typeof params[key] === 'string') {
        return params[key] as string;
      }
    }

    // Check nested parameters
    if (typeof params.arguments === 'object' && params.arguments !== null) {
      const args = params.arguments as Record<string, unknown>;
      for (const key of commandKeys) {
        if (typeof args[key] === 'string') {
          return args[key] as string;
        }
      }
    }

    return null;
  }

  private allowResult(): EngineResult {
    return {
      engine_id: this.id,
      engine_name: this.name,
      detected: false,
      severity: 'info',
      confidence: 1.0,
      action: 'allow',
      details: {},
      latency_ms: 0,
    };
  }

  /**
   * Static method for use by ATSP
   */
  static isBlockedCommand(command: string): boolean {
    for (const { pattern } of BLOCKED_PATTERNS) {
      if (pattern.test(command)) {
        return true;
      }
    }
    return false;
  }
}
