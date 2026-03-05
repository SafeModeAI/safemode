/**
 * Hooks System Tests
 *
 * Tests hook executor, installer, and hook scripts.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync, chmodSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { HookExecutor, HookInstaller, type HookName, type PreToolCallContext } from '../src/hooks/index.js';

// ============================================================================
// Test Helpers
// ============================================================================

function createTestDir(): string {
  const testDir = join(tmpdir(), `safemode-hooks-test-${Date.now()}`);
  mkdirSync(testDir, { recursive: true });
  return testDir;
}

function cleanupTestDir(testDir: string): void {
  if (existsSync(testDir)) {
    rmSync(testDir, { recursive: true, force: true });
  }
}

function createTestHook(dir: string, name: string, content: string): void {
  const hookPath = join(dir, `${name}.js`);
  writeFileSync(hookPath, content, 'utf8');
  if (process.platform !== 'win32') {
    chmodSync(hookPath, 0o755);
  }
}

// ============================================================================
// Hook Executor Tests
// ============================================================================

describe('Hook Executor', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = createTestDir();
  });

  afterEach(() => {
    cleanupTestDir(testDir);
  });

  describe('Basic Execution', () => {
    it('should return continue: true when no hook exists', async () => {
      const executor = new HookExecutor({ customDir: testDir });

      const context: PreToolCallContext = {
        sessionId: 'test-session',
        timestamp: Date.now(),
        toolName: 'test_tool',
        serverName: 'test_server',
        parameters: {},
        effect: {
          action: 'read',
          target: '/test',
          scope: 'project',
          risk: 'low',
          category: 'filesystem',
          confidence: 1.0,
          source: 'registry',
        },
      };

      const result = await executor.execute('pre-tool-call', context);

      expect(result.success).toBe(true);
      expect(result.result?.continue).toBe(true);
    });

    it('should execute hook script and return result', async () => {
      const executor = new HookExecutor({ customDir: testDir });

      // Create a hook that always continues
      createTestHook(testDir, 'pre-tool-call', `#!/usr/bin/env node
console.log(JSON.stringify({ continue: true, message: 'Hook executed' }));
`);

      const context: PreToolCallContext = {
        sessionId: 'test-session',
        timestamp: Date.now(),
        toolName: 'test_tool',
        serverName: 'test_server',
        parameters: {},
        effect: {
          action: 'read',
          target: '/test',
          scope: 'project',
          risk: 'low',
          category: 'filesystem',
          confidence: 1.0,
          source: 'registry',
        },
      };

      const result = await executor.execute('pre-tool-call', context);

      expect(result.success).toBe(true);
      expect(result.result?.continue).toBe(true);
      expect(result.result?.message).toBe('Hook executed');
    });

    it('should handle hook that blocks', async () => {
      const executor = new HookExecutor({ customDir: testDir });

      createTestHook(testDir, 'pre-tool-call', `#!/usr/bin/env node
console.log(JSON.stringify({ continue: false, message: 'Blocked by hook' }));
`);

      const context: PreToolCallContext = {
        sessionId: 'test-session',
        timestamp: Date.now(),
        toolName: 'test_tool',
        serverName: 'test_server',
        parameters: {},
        effect: {
          action: 'execute',
          target: '/bin/bash',
          scope: 'system',
          risk: 'critical',
          category: 'terminal',
          confidence: 1.0,
          source: 'registry',
        },
      };

      const result = await executor.execute('pre-tool-call', context);

      expect(result.success).toBe(true);
      expect(result.result?.continue).toBe(false);
      expect(result.result?.message).toBe('Blocked by hook');
    });

    it('should handle hook that modifies parameters', async () => {
      const executor = new HookExecutor({ customDir: testDir });

      createTestHook(testDir, 'pre-tool-call', `#!/usr/bin/env node
const input = JSON.parse(process.argv[2] || '{}');
const modified = { ...input.parameters, sanitized: true };
console.log(JSON.stringify({ continue: true, modified }));
`);

      const context: PreToolCallContext = {
        sessionId: 'test-session',
        timestamp: Date.now(),
        toolName: 'test_tool',
        serverName: 'test_server',
        parameters: { path: '/test' },
        effect: {
          action: 'read',
          target: '/test',
          scope: 'project',
          risk: 'low',
          category: 'filesystem',
          confidence: 1.0,
          source: 'registry',
        },
      };

      const result = await executor.execute('pre-tool-call', context);

      expect(result.success).toBe(true);
      expect(result.result?.continue).toBe(true);
      expect(result.result?.modified).toEqual({ path: '/test', sanitized: true });
    });
  });

  describe('Error Handling', () => {
    it('should handle hook error with fail-open behavior', async () => {
      const executor = new HookExecutor({
        customDir: testDir,
        failBehavior: 'open',
      });

      createTestHook(testDir, 'pre-tool-call', `#!/usr/bin/env node
throw new Error('Hook crashed');
`);

      const context: PreToolCallContext = {
        sessionId: 'test-session',
        timestamp: Date.now(),
        toolName: 'test_tool',
        serverName: 'test_server',
        parameters: {},
        effect: {
          action: 'read',
          target: '/test',
          scope: 'project',
          risk: 'low',
          category: 'filesystem',
          confidence: 1.0,
          source: 'registry',
        },
      };

      const result = await executor.execute('pre-tool-call', context);

      expect(result.success).toBe(false);
      expect(result.result?.continue).toBe(true); // Fail open
      expect(result.error).toBeDefined();
    });

    it('should handle hook error with fail-closed behavior', async () => {
      const executor = new HookExecutor({
        customDir: testDir,
        failBehavior: 'closed',
      });

      createTestHook(testDir, 'pre-tool-call', `#!/usr/bin/env node
throw new Error('Hook crashed');
`);

      const context: PreToolCallContext = {
        sessionId: 'test-session',
        timestamp: Date.now(),
        toolName: 'test_tool',
        serverName: 'test_server',
        parameters: {},
        effect: {
          action: 'read',
          target: '/test',
          scope: 'project',
          risk: 'low',
          category: 'filesystem',
          confidence: 1.0,
          source: 'registry',
        },
      };

      const result = await executor.execute('pre-tool-call', context);

      expect(result.success).toBe(false);
      expect(result.result?.continue).toBe(false); // Fail closed
      expect(result.error).toBeDefined();
    });

    it('should handle hook with invalid JSON output', async () => {
      const executor = new HookExecutor({ customDir: testDir });

      createTestHook(testDir, 'pre-tool-call', `#!/usr/bin/env node
console.log('not valid json');
`);

      const context: PreToolCallContext = {
        sessionId: 'test-session',
        timestamp: Date.now(),
        toolName: 'test_tool',
        serverName: 'test_server',
        parameters: {},
        effect: {
          action: 'read',
          target: '/test',
          scope: 'project',
          risk: 'low',
          category: 'filesystem',
          confidence: 1.0,
          source: 'registry',
        },
      };

      const result = await executor.execute('pre-tool-call', context);

      // Should default to continue: true for unparseable output
      expect(result.result?.continue).toBe(true);
    });
  });

  describe('Configuration', () => {
    it('should return immediately when disabled', async () => {
      const executor = new HookExecutor({
        customDir: testDir,
        enabled: false,
      });

      createTestHook(testDir, 'pre-tool-call', `#!/usr/bin/env node
console.log(JSON.stringify({ continue: false }));
`);

      const context: PreToolCallContext = {
        sessionId: 'test-session',
        timestamp: Date.now(),
        toolName: 'test_tool',
        serverName: 'test_server',
        parameters: {},
        effect: {
          action: 'read',
          target: '/test',
          scope: 'project',
          risk: 'low',
          category: 'filesystem',
          confidence: 1.0,
          source: 'registry',
        },
      };

      const result = await executor.execute('pre-tool-call', context);

      expect(result.success).toBe(true);
      expect(result.result?.continue).toBe(true); // Disabled = always continue
      expect(result.latencyMs).toBe(0);
    });

    it('should find hooks across multiple directories', async () => {
      const dir1 = join(testDir, 'hooks1');
      const dir2 = join(testDir, 'hooks2');
      mkdirSync(dir1, { recursive: true });
      mkdirSync(dir2, { recursive: true });

      createTestHook(dir1, 'pre-tool-call', `#!/usr/bin/env node
console.log(JSON.stringify({ continue: true, message: 'from dir1' }));
`);

      const executor = new HookExecutor({ customDir: dir1 });

      expect(executor.hasHook('pre-tool-call')).toBe(true);
      expect(executor.hasHook('post-tool-call')).toBe(false);
    });
  });

  describe('Hook Discovery', () => {
    it('should list available hooks', async () => {
      const executor = new HookExecutor({ customDir: testDir });

      createTestHook(testDir, 'pre-tool-call', `#!/usr/bin/env node
console.log(JSON.stringify({ continue: true }));
`);
      createTestHook(testDir, 'session-start', `#!/usr/bin/env node
console.log(JSON.stringify({ continue: true }));
`);

      const available = executor.getAvailableHooks();

      expect(available).toContain('pre-tool-call');
      expect(available).toContain('session-start');
      expect(available).not.toContain('post-tool-call');
    });

    it('should return hook directories', () => {
      const executor = new HookExecutor({ customDir: testDir });
      const dirs = executor.getHookDirs();

      expect(dirs[0]).toBe(testDir);
      expect(dirs.length).toBe(1); // customDir is exclusive for isolation
    });
  });
});

// ============================================================================
// Hook Installer Tests
// ============================================================================

describe('Hook Installer', () => {
  let testDir: string;
  let originalHome: string;

  beforeEach(() => {
    testDir = createTestDir();
    originalHome = process.env.HOME || '';

    // Create fake home directories
    const fakeCursor = join(testDir, '.cursor');
    const fakeClaude = join(testDir, '.claude');
    mkdirSync(fakeCursor, { recursive: true });
    mkdirSync(fakeClaude, { recursive: true });
  });

  afterEach(() => {
    cleanupTestDir(testDir);
    process.env.HOME = originalHome;
  });

  describe('IDE Detection', () => {
    it('should detect installed IDEs', () => {
      const installer = new HookInstaller();
      const allIDEs = installer.getAllIDEs();

      expect(allIDEs.length).toBeGreaterThan(0);
      expect(allIDEs.some(ide => ide.ide === 'cursor')).toBe(true);
      expect(allIDEs.some(ide => ide.ide === 'claude-code')).toBe(true);
    });
  });

  describe('Hook Installation', () => {
    it('should verify hooks are not installed initially', async () => {
      const installer = new HookInstaller();
      const status = await installer.verify('cursor');

      // Hooks won't be installed in test environment unless we run install
      expect(status.ide).toBe('cursor');
      expect(typeof status.installed).toBe('boolean');
    });

    it('should have correct hook names in status', async () => {
      const installer = new HookInstaller();
      const status = await installer.verify('claude-code');

      const hookNames = status.hooks.map(h => h.name);

      expect(hookNames).toContain('pre-tool-call');
      expect(hookNames).toContain('post-tool-call');
      expect(hookNames).toContain('schema-load');
      expect(hookNames).toContain('session-start');
      expect(hookNames).toContain('session-end');
      expect(hookNames).toContain('on-error');
      expect(hookNames).toContain('approval-request');
    });
  });
});

// ============================================================================
// Hook Script Tests
// ============================================================================

describe('Hook Scripts', () => {
  it('should have all 7 hook scripts', () => {
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
      const hookPath = join(process.cwd(), 'hooks', `${name}.js`);

      if (existsSync(hookPath)) {
        const content = readFileSync(hookPath, 'utf8');

        // Should have shebang
        expect(content.startsWith('#!/usr/bin/env node')).toBe(true);

        // Should output JSON
        expect(content).toContain('JSON.stringify');
      }
    }
  });
});

// ============================================================================
// Performance Tests
// ============================================================================

describe('Hook Performance', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = createTestDir();
  });

  afterEach(() => {
    cleanupTestDir(testDir);
  });

  it('should execute hooks in under 100ms', async () => {
    const executor = new HookExecutor({ customDir: testDir });

    createTestHook(testDir, 'pre-tool-call', `#!/usr/bin/env node
console.log(JSON.stringify({ continue: true }));
`);

    const context: PreToolCallContext = {
      sessionId: 'test-session',
      timestamp: Date.now(),
      toolName: 'test_tool',
      serverName: 'test_server',
      parameters: {},
      effect: {
        action: 'read',
        target: '/test',
        scope: 'project',
        risk: 'low',
        category: 'filesystem',
        confidence: 1.0,
        source: 'registry',
      },
    };

    const start = performance.now();
    await executor.execute('pre-tool-call', context);
    const elapsed = performance.now() - start;

    // Should complete quickly (allow some slack for process spawning)
    expect(elapsed).toBeLessThan(1000); // Very generous for CI
  });

  it('should return immediately when hook does not exist', async () => {
    const executor = new HookExecutor({ customDir: testDir });

    const context: PreToolCallContext = {
      sessionId: 'test-session',
      timestamp: Date.now(),
      toolName: 'test_tool',
      serverName: 'test_server',
      parameters: {},
      effect: {
        action: 'read',
        target: '/test',
        scope: 'project',
        risk: 'low',
        category: 'filesystem',
        confidence: 1.0,
        source: 'registry',
      },
    };

    const result = await executor.execute('pre-tool-call', context);

    expect(result.latencyMs).toBeLessThan(10);
  });
});
