/**
 * Bridge Tests
 *
 * Tests for the TrustScope cloud bridge.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  BridgeClient,
  resetBridgeClient,
  DEFAULT_BRIDGE_CONFIG,
  type BridgeConfig,
  type SyncEvent,
  type CloudPolicy,
} from '../src/bridge/index.js';

import {
  validateApiKey,
  generateDeviceId,
} from '../src/bridge/auth.js';

import {
  queueEvent,
  getPendingCount,
  getSyncStats,
  clearPendingEvents,
} from '../src/bridge/sync.js';

import {
  extractKnobOverrides,
  mergeKnobOverrides,
  computePolicyHash,
  havePoliciesChanged,
} from '../src/bridge/policy.js';

import {
  recordToolCall,
  recordDetection,
  recordBlock,
  recordError,
  getHeartbeatStats,
  setConnectionState,
  getConnectionStatus,
} from '../src/bridge/heartbeat.js';

// ============================================================================
// Test Helpers
// ============================================================================

function createTestDir(): string {
  const testDir = join(tmpdir(), `safemode-bridge-test-${Date.now()}`);
  mkdirSync(testDir, { recursive: true });
  return testDir;
}

function cleanupTestDir(testDir: string): void {
  if (existsSync(testDir)) {
    rmSync(testDir, { recursive: true, force: true });
  }
}

// ============================================================================
// Auth Tests
// ============================================================================

describe('Bridge Auth', () => {
  describe('validateApiKey', () => {
    it('should validate smdev_ prefixed keys', () => {
      const result = validateApiKey('smdev_1234567890abcdef');
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should validate ts_ prefixed keys', () => {
      const result = validateApiKey('ts_1234567890abcdefghij');
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should reject empty keys', () => {
      const result = validateApiKey('');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('required');
    });

    it('should reject invalid prefixes', () => {
      const result = validateApiKey('invalid_1234567890');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('smdev_');
    });

    it('should reject short keys', () => {
      const result = validateApiKey('smdev_short');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('too short');
    });
  });

  describe('generateDeviceId', () => {
    it('should generate unique IDs', () => {
      const id1 = generateDeviceId();
      const id2 = generateDeviceId();

      expect(id1).not.toBe(id2);
    });

    it('should have sm_ prefix', () => {
      const id = generateDeviceId();
      expect(id.startsWith('sm_')).toBe(true);
    });

    it('should be reasonable length', () => {
      const id = generateDeviceId();
      expect(id.length).toBeGreaterThan(10);
      expect(id.length).toBeLessThan(30);
    });
  });
});

// ============================================================================
// Sync Tests
// ============================================================================

describe('Bridge Sync', () => {
  beforeEach(() => {
    clearPendingEvents();
  });

  afterEach(() => {
    clearPendingEvents();
  });

  describe('queueEvent', () => {
    it('should add events to queue', () => {
      expect(getPendingCount()).toBe(0);

      queueEvent({
        sessionId: 'test-session',
        type: 'tool_call',
        toolName: 'test_tool',
        serverName: 'test_server',
      });

      expect(getPendingCount()).toBe(1);
    });

    it('should track multiple events', () => {
      for (let i = 0; i < 5; i++) {
        queueEvent({
          sessionId: 'test-session',
          type: 'tool_call',
          toolName: `tool_${i}`,
          serverName: 'test_server',
        });
      }

      expect(getPendingCount()).toBe(5);
    });
  });

  describe('getSyncStats', () => {
    it('should return stats', () => {
      const stats = getSyncStats();

      expect(stats).toHaveProperty('pending');
      expect(stats).toHaveProperty('synced');
      expect(stats).toHaveProperty('failed');
      expect(stats).toHaveProperty('lastSync');
    });
  });
});

// ============================================================================
// Policy Tests
// ============================================================================

describe('Bridge Policy', () => {
  describe('extractKnobOverrides', () => {
    it('should extract knob overrides from policies', () => {
      const policies: CloudPolicy[] = [
        {
          id: 'policy-1',
          name: 'Test Policy',
          version: 1,
          type: 'custom',
          config: {
            knobs: {
              terminal: {
                command_exec: 'block',
              },
            },
          },
          enabled: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];

      const overrides = extractKnobOverrides(policies);

      expect(overrides).toHaveLength(1);
      expect(overrides[0].category).toBe('terminal');
      expect(overrides[0].knob).toBe('command_exec');
      expect(overrides[0].value).toBe('block');
    });

    it('should skip disabled policies', () => {
      const policies: CloudPolicy[] = [
        {
          id: 'policy-1',
          name: 'Disabled Policy',
          version: 1,
          type: 'custom',
          config: {
            knobs: {
              terminal: {
                command_exec: 'block',
              },
            },
          },
          enabled: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];

      const overrides = extractKnobOverrides(policies);
      expect(overrides).toHaveLength(0);
    });
  });

  describe('mergeKnobOverrides', () => {
    it('should apply strictest value', () => {
      const base = {
        terminal: {
          command_exec: 'allow' as const,
        },
      };

      const overrides = [
        {
          category: 'terminal',
          knob: 'command_exec',
          value: 'approve' as const,
        },
      ];

      const result = mergeKnobOverrides(base, overrides);

      expect(result.terminal.command_exec).toBe('approve');
    });

    it('should not weaken values', () => {
      const base = {
        terminal: {
          command_exec: 'block' as const,
        },
      };

      const overrides = [
        {
          category: 'terminal',
          knob: 'command_exec',
          value: 'allow' as const,
        },
      ];

      const result = mergeKnobOverrides(base, overrides);

      // Block is stricter than allow, so block wins
      expect(result.terminal.command_exec).toBe('block');
    });

    it('should add new knobs', () => {
      const base = {
        terminal: {
          command_exec: 'allow' as const,
        },
      };

      const overrides = [
        {
          category: 'filesystem',
          knob: 'file_write',
          value: 'approve' as const,
        },
      ];

      const result = mergeKnobOverrides(base, overrides);

      expect(result.filesystem.file_write).toBe('approve');
    });
  });

  describe('computePolicyHash', () => {
    it('should produce consistent hashes', () => {
      const policies: CloudPolicy[] = [
        {
          id: 'policy-1',
          name: 'Test',
          version: 1,
          type: 'custom',
          config: {},
          enabled: true,
          createdAt: '2024-01-01',
          updatedAt: '2024-01-01',
        },
      ];

      const hash1 = computePolicyHash(policies);
      const hash2 = computePolicyHash(policies);

      expect(hash1).toBe(hash2);
    });

    it('should detect changes', () => {
      const policies1: CloudPolicy[] = [
        {
          id: 'policy-1',
          name: 'Test',
          version: 1,
          type: 'custom',
          config: {},
          enabled: true,
          createdAt: '2024-01-01',
          updatedAt: '2024-01-01',
        },
      ];

      const policies2: CloudPolicy[] = [
        {
          id: 'policy-1',
          name: 'Test Modified',
          version: 2,
          type: 'custom',
          config: {},
          enabled: true,
          createdAt: '2024-01-01',
          updatedAt: '2024-01-02',
        },
      ];

      const hash1 = computePolicyHash(policies1);
      const hash2 = computePolicyHash(policies2);

      expect(hash1).not.toBe(hash2);
    });
  });
});

// ============================================================================
// Heartbeat Tests
// ============================================================================

describe('Bridge Heartbeat', () => {
  describe('stats tracking', () => {
    it('should track tool calls', () => {
      const before = getHeartbeatStats();
      recordToolCall();
      const after = getHeartbeatStats();

      expect(after.toolCalls).toBe(before.toolCalls + 1);
    });

    it('should track detections', () => {
      const before = getHeartbeatStats();
      recordDetection();
      const after = getHeartbeatStats();

      expect(after.detections).toBe(before.detections + 1);
    });

    it('should track blocks', () => {
      const before = getHeartbeatStats();
      recordBlock();
      const after = getHeartbeatStats();

      expect(after.blocks).toBe(before.blocks + 1);
    });

    it('should track errors', () => {
      const before = getHeartbeatStats();
      recordError();
      const after = getHeartbeatStats();

      expect(after.errors).toBe(before.errors + 1);
    });
  });

  describe('connection state', () => {
    it('should track state transitions', () => {
      setConnectionState('connecting');
      expect(getConnectionStatus().state).toBe('connecting');

      setConnectionState('connected');
      expect(getConnectionStatus().state).toBe('connected');
      expect(getConnectionStatus().retryCount).toBe(0);
    });

    it('should track errors', () => {
      setConnectionState('error', 'Connection refused');
      const status = getConnectionStatus();

      expect(status.state).toBe('error');
      expect(status.lastError).toBe('Connection refused');
      expect(status.retryCount).toBeGreaterThan(0);
    });
  });
});

// ============================================================================
// BridgeClient Tests
// ============================================================================

describe('BridgeClient', () => {
  beforeEach(() => {
    resetBridgeClient();
  });

  afterEach(() => {
    resetBridgeClient();
  });

  describe('construction', () => {
    it('should use default config', () => {
      const client = new BridgeClient();

      // Client should initialize without error
      expect(client).toBeDefined();
      expect(client.isRunning()).toBe(false);
    });

    it('should accept custom config', () => {
      const client = new BridgeClient({
        apiUrl: 'https://custom.api.com',
        syncIntervalMs: 60000,
      });

      expect(client).toBeDefined();
    });
  });

  describe('isRegistered', () => {
    it('should return false when not registered', () => {
      const client = new BridgeClient();
      expect(client.isRegistered()).toBe(false);
    });
  });

  describe('tracking methods', () => {
    it('should queue tool call events', () => {
      const client = new BridgeClient();
      clearPendingEvents();

      client.trackToolCall('session-1', 'tool', 'server', 'allow');

      expect(client.getPendingCount()).toBe(1);
    });

    it('should queue detection events', () => {
      const client = new BridgeClient();
      clearPendingEvents();

      client.trackDetection('session-1', 'tool', 'server', [], 'medium');

      expect(client.getPendingCount()).toBe(1);
    });

    it('should queue block events', () => {
      const client = new BridgeClient();
      clearPendingEvents();

      client.trackBlock('session-1', 'tool', 'server', 'reason', 'engine');

      expect(client.getPendingCount()).toBe(1);
    });
  });

  describe('health', () => {
    it('should report health status', () => {
      const client = new BridgeClient();
      const health = client.getHealth();

      expect(health).toHaveProperty('healthy');
      expect(health).toHaveProperty('state');
      expect(health).toHaveProperty('pendingEvents');
      expect(health).toHaveProperty('errorCount');
      expect(health).toHaveProperty('avgLatencyMs');
    });
  });

  describe('policy methods', () => {
    it('should check shouldBlock', () => {
      const client = new BridgeClient();
      const result = client.shouldBlock('tool', 'server');

      expect(result).toHaveProperty('blocked');
      expect(result.blocked).toBe(false); // No policies loaded
    });

    it('should check requiresApproval', () => {
      const client = new BridgeClient();
      const result = client.requiresApproval('tool', 'server');

      expect(result).toHaveProperty('required');
      expect(result.required).toBe(false); // No policies loaded
    });
  });
});

// ============================================================================
// Default Config Tests
// ============================================================================

describe('DEFAULT_BRIDGE_CONFIG', () => {
  it('should have sensible defaults', () => {
    expect(DEFAULT_BRIDGE_CONFIG.apiUrl).toBe('https://api.trustscope.ai');
    expect(DEFAULT_BRIDGE_CONFIG.syncIntervalMs).toBeGreaterThan(0);
    expect(DEFAULT_BRIDGE_CONFIG.heartbeatIntervalMs).toBeGreaterThan(0);
    expect(DEFAULT_BRIDGE_CONFIG.batchSize).toBeGreaterThan(0);
    expect(DEFAULT_BRIDGE_CONFIG.maxRetries).toBeGreaterThan(0);
    expect(DEFAULT_BRIDGE_CONFIG.timeoutMs).toBeGreaterThan(0);
  });

  it('should have reasonable intervals', () => {
    // Sync interval should be reasonable (5 seconds to 5 minutes)
    expect(DEFAULT_BRIDGE_CONFIG.syncIntervalMs).toBeGreaterThanOrEqual(5000);
    expect(DEFAULT_BRIDGE_CONFIG.syncIntervalMs).toBeLessThanOrEqual(300000);

    // Heartbeat should be similar
    expect(DEFAULT_BRIDGE_CONFIG.heartbeatIntervalMs).toBeGreaterThanOrEqual(10000);
    expect(DEFAULT_BRIDGE_CONFIG.heartbeatIntervalMs).toBeLessThanOrEqual(300000);
  });
});

// ============================================================================
// Integration Tests
// ============================================================================

describe('Bridge Integration', () => {
  beforeEach(() => {
    resetBridgeClient();
    clearPendingEvents();
  });

  afterEach(() => {
    resetBridgeClient();
    clearPendingEvents();
  });

  it('should track multiple event types', () => {
    const client = new BridgeClient();

    client.trackSessionStart('session-1', 'server');
    client.trackToolCall('session-1', 'tool1', 'server', 'allow');
    client.trackDetection('session-1', 'tool1', 'server', [], 'low');
    client.trackToolCall('session-1', 'tool2', 'server', 'block');
    client.trackBlock('session-1', 'tool2', 'server', 'blocked', 'firewall');
    client.trackSessionEnd('session-1', {
      toolCalls: 2,
      detections: 1,
      blocks: 1,
      durationMs: 5000,
    });

    expect(client.getPendingCount()).toBe(6);
  });

  it('should merge knobs from multiple policies', () => {
    const base = {
      terminal: {
        command_exec: 'allow' as const,
        destructive_commands: 'allow' as const,
      },
      filesystem: {
        file_write: 'allow' as const,
      },
    };

    const overrides = [
      { category: 'terminal', knob: 'command_exec', value: 'approve' as const },
      { category: 'terminal', knob: 'destructive_commands', value: 'block' as const },
      { category: 'filesystem', knob: 'file_delete', value: 'block' as const },
    ];

    const result = mergeKnobOverrides(base, overrides);

    expect(result.terminal.command_exec).toBe('approve');
    expect(result.terminal.destructive_commands).toBe('block');
    expect(result.filesystem.file_write).toBe('allow'); // Unchanged
    expect(result.filesystem.file_delete).toBe('block'); // New
  });
});
