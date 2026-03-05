/**
 * Hook Executor
 *
 * Executes hook scripts with proper error handling and timeouts.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

import type {
  HookName,
  HookContext,
  HookResult,
  HookExecutionResult,
  HookConfig,
} from './types.js';

// ============================================================================
// Hook Executor
// ============================================================================

export class HookExecutor {
  private config: HookConfig;
  private hookDirs: string[];

  constructor(config: Partial<HookConfig> = {}) {
    this.config = {
      enabled: config.enabled ?? true,
      timeoutMs: config.timeoutMs ?? 10000,
      failBehavior: config.failBehavior ?? 'open',
      customDir: config.customDir,
    };

    // Build list of hook directories to check
    this.hookDirs = [];

    if (this.config.customDir) {
      // When customDir is set, only use that directory (enables test isolation)
      this.hookDirs.push(this.config.customDir);
    } else {
      // Default hook locations
      this.hookDirs.push(
        join(homedir(), '.cursor', 'hooks'),
        join(homedir(), '.claude', 'hooks'),
        join(homedir(), '.safemode', 'hooks'),
      );
    }
  }

  /**
   * Execute a hook with the given context
   */
  async execute(hookName: HookName, context: HookContext): Promise<HookExecutionResult> {
    const startTime = performance.now();

    if (!this.config.enabled) {
      return {
        hookName,
        success: true,
        result: { continue: true },
        latencyMs: 0,
      };
    }

    // Find hook script
    const hookPath = this.findHook(hookName);

    if (!hookPath) {
      // No hook found - that's OK, just continue
      return {
        hookName,
        success: true,
        result: { continue: true },
        latencyMs: performance.now() - startTime,
      };
    }

    try {
      const result = await this.executeScript(hookPath, context);

      return {
        hookName,
        success: true,
        result,
        latencyMs: performance.now() - startTime,
      };
    } catch (error) {
      const latencyMs = performance.now() - startTime;

      // Fail behavior determines whether we continue or abort
      if (this.config.failBehavior === 'closed') {
        return {
          hookName,
          success: false,
          error: (error as Error).message,
          result: { continue: false, message: `Hook error: ${(error as Error).message}` },
          latencyMs,
        };
      }

      // Fail open - continue despite error
      return {
        hookName,
        success: false,
        error: (error as Error).message,
        result: { continue: true },
        latencyMs,
      };
    }
  }

  /**
   * Execute multiple hooks in sequence
   */
  async executeAll(
    hookName: HookName,
    context: HookContext
  ): Promise<HookExecutionResult[]> {
    const results: HookExecutionResult[] = [];

    // Find all hooks with this name across all directories
    const hookPaths = this.findAllHooks(hookName);

    for (const hookPath of hookPaths) {
      const startTime = performance.now();

      try {
        const result = await this.executeScript(hookPath, context);

        results.push({
          hookName,
          success: true,
          result,
          latencyMs: performance.now() - startTime,
        });

        // If any hook says don't continue, stop
        if (!result.continue) {
          break;
        }

        // If hook modified context, use modified version for next hook
        if (result.modified) {
          (context as unknown as Record<string, unknown>).parameters = result.modified;
        }
      } catch (error) {
        const latencyMs = performance.now() - startTime;

        results.push({
          hookName,
          success: false,
          error: (error as Error).message,
          result: { continue: this.config.failBehavior === 'open' },
          latencyMs,
        });

        if (this.config.failBehavior === 'closed') {
          break;
        }
      }
    }

    return results;
  }

  /**
   * Find a hook script by name
   */
  private findHook(hookName: HookName): string | null {
    for (const dir of this.hookDirs) {
      const jsPath = join(dir, `${hookName}.js`);
      if (existsSync(jsPath)) {
        return jsPath;
      }

      const tsPath = join(dir, `${hookName}.ts`);
      if (existsSync(tsPath)) {
        return tsPath;
      }

      // Also check without extension (for compiled/shebang scripts)
      const noExtPath = join(dir, hookName);
      if (existsSync(noExtPath)) {
        return noExtPath;
      }
    }

    return null;
  }

  /**
   * Find all hooks with a given name across all directories
   */
  private findAllHooks(hookName: HookName): string[] {
    const hooks: string[] = [];

    for (const dir of this.hookDirs) {
      const jsPath = join(dir, `${hookName}.js`);
      if (existsSync(jsPath)) {
        hooks.push(jsPath);
        continue; // Only one hook per directory
      }

      const tsPath = join(dir, `${hookName}.ts`);
      if (existsSync(tsPath)) {
        hooks.push(tsPath);
        continue;
      }

      const noExtPath = join(dir, hookName);
      if (existsSync(noExtPath)) {
        hooks.push(noExtPath);
      }
    }

    return hooks;
  }

  /**
   * Execute a hook script and parse its output
   */
  private executeScript(scriptPath: string, context: HookContext): Promise<HookResult> {
    return new Promise((resolve, reject) => {
      const contextJson = JSON.stringify(context);

      // Determine how to run the script
      let command: string;
      let args: string[];

      if (scriptPath.endsWith('.ts')) {
        // TypeScript - use ts-node or tsx
        command = 'npx';
        args = ['tsx', scriptPath, contextJson];
      } else {
        // JavaScript or other - run with node
        command = 'node';
        args = [scriptPath, contextJson];
      }

      const child = spawn(command, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: this.config.timeoutMs,
        env: {
          ...process.env,
          SAFEMODE_HOOK: 'true',
        },
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      const timeoutId = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error(`Hook timed out after ${this.config.timeoutMs}ms`));
      }, this.config.timeoutMs);

      child.on('close', (code) => {
        clearTimeout(timeoutId);

        if (code !== 0) {
          reject(new Error(`Hook exited with code ${code}: ${stderr}`));
          return;
        }

        try {
          // Parse the last line of stdout as JSON result
          const lines = stdout.trim().split('\n');
          const lastLine = lines[lines.length - 1] || '{}';
          const result = JSON.parse(lastLine) as HookResult;

          // Ensure result has required fields
          resolve({
            continue: result.continue ?? true,
            modified: result.modified,
            message: result.message,
            approved: result.approved,
          });
        } catch {
          // If we can't parse output, assume success and continue
          resolve({ continue: true });
        }
      });

      child.on('error', (error) => {
        clearTimeout(timeoutId);
        reject(error);
      });
    });
  }

  /**
   * Check if a hook exists
   */
  hasHook(hookName: HookName): boolean {
    return this.findHook(hookName) !== null;
  }

  /**
   * Get all available hooks
   */
  getAvailableHooks(): HookName[] {
    const available: HookName[] = [];
    const hookNames: HookName[] = [
      'pre-tool-call',
      'post-tool-call',
      'schema-load',
      'session-start',
      'session-end',
      'on-error',
      'approval-request',
    ];

    for (const name of hookNames) {
      if (this.hasHook(name)) {
        available.push(name);
      }
    }

    return available;
  }

  /**
   * Get hook directories being searched
   */
  getHookDirs(): string[] {
    return [...this.hookDirs];
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let _hookExecutor: HookExecutor | null = null;

export function getHookExecutor(config?: Partial<HookConfig>): HookExecutor {
  if (!_hookExecutor) {
    _hookExecutor = new HookExecutor(config);
  }
  return _hookExecutor;
}

export function resetHookExecutor(): void {
  _hookExecutor = null;
}
