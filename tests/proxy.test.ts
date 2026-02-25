/**
 * MCP Proxy Protocol Tests
 *
 * Tests the MCP protocol types and utilities.
 */

import { describe, it, expect } from 'vitest';
import {
  parseMessage,
  serializeMessage,
  isRequest,
  isResponse,
  createBlockedResponse,
  INTERCEPTED_METHODS,
  type JSONRPCRequest,
  type JSONRPCResponse,
} from '../src/proxy/protocol.js';

describe('MCP Protocol Types', () => {
  describe('Message Parsing', () => {
    it('should parse valid JSON-RPC request', () => {
      const raw = '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}';
      const parsed = parseMessage(raw);

      expect(parsed).toBeDefined();
      expect(parsed?.jsonrpc).toBe('2.0');
      expect(parsed?.id).toBe(1);
    });

    it('should parse tools/call request', () => {
      const raw = JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'read_file',
          arguments: {
            path: './src/index.ts',
          },
        },
      });

      const parsed = parseMessage(raw);

      expect(parsed).toBeDefined();
      expect((parsed as any).method).toBe('tools/call');
      expect((parsed as any).params.name).toBe('read_file');
    });

    it('should handle invalid JSON gracefully', () => {
      const invalid = 'not valid json';
      const parsed = parseMessage(invalid);

      expect(parsed).toBeNull();
    });
  });

  describe('Message Identification', () => {
    it('should identify requests', () => {
      const request: JSONRPCRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
      };

      expect(isRequest(request)).toBe(true);
      expect(isResponse(request)).toBe(false);
    });

    it('should identify responses with result', () => {
      const response: JSONRPCResponse = {
        jsonrpc: '2.0',
        id: 1,
        result: { tools: [] },
      };

      expect(isResponse(response)).toBe(true);
      expect(isRequest(response)).toBe(false);
    });

    it('should identify error responses', () => {
      const error: JSONRPCResponse = {
        jsonrpc: '2.0',
        id: 1,
        error: {
          code: -32001,
          message: 'Error',
        },
      };

      expect(isResponse(error)).toBe(true);
    });
  });

  describe('Message Serialization', () => {
    it('should serialize message to string', () => {
      const message = {
        jsonrpc: '2.0',
        id: 1,
        result: { data: 'test' },
      };

      const serialized = serializeMessage(message);

      expect(typeof serialized).toBe('string');
      expect(serialized).toContain('"jsonrpc":"2.0"');
    });

    it('should round-trip correctly', () => {
      const original = {
        jsonrpc: '2.0',
        id: 42,
        method: 'test/method',
        params: { key: 'value' },
      };

      const serialized = serializeMessage(original);
      const parsed = parseMessage(serialized);

      expect(parsed).toEqual(original);
    });
  });

  describe('Blocked Response Generation', () => {
    it('should create proper Safe Mode error response', () => {
      const error = createBlockedResponse(
        5,
        'command_firewall',
        'critical',
        'rm -rf / is permanently blocked'
      );

      expect(error.jsonrpc).toBe('2.0');
      expect(error.id).toBe(5);
      expect(error.error.code).toBe(-32001);
      expect(error.error.message).toContain('Safe Mode');
      expect(error.error.data?.engine).toBe('command_firewall');
      expect(error.error.data?.severity).toBe('critical');
      expect(error.error.data?.safemode).toBe(true);
    });

    it('should include reason in error data', () => {
      const error = createBlockedResponse(
        1,
        'secrets_scanner',
        'high',
        'AWS key detected'
      );

      expect(error.error.data?.reason).toBe('AWS key detected');
    });
  });

  describe('Intercepted Methods', () => {
    it('should intercept tools/list', () => {
      expect(INTERCEPTED_METHODS.TOOLS_LIST).toBe('tools/list');
    });

    it('should intercept tools/call', () => {
      expect(INTERCEPTED_METHODS.TOOLS_CALL).toBe('tools/call');
    });
  });
});

describe('Protocol Constants', () => {
  it('should have proper error codes', () => {
    const error = createBlockedResponse(1, 'test', 'low', 'test');

    // Safe Mode uses -32001 for blocked actions
    expect(error.error.code).toBe(-32001);
  });
});

describe('Performance', () => {
  it('should parse messages quickly', () => {
    const message = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'test_tool',
        arguments: { data: 'x'.repeat(1000) },
      },
    });

    const start = performance.now();

    for (let i = 0; i < 1000; i++) {
      parseMessage(message);
    }

    const elapsed = performance.now() - start;
    const avgTime = elapsed / 1000;

    // Should be <1ms per parse
    expect(avgTime).toBeLessThan(1);
  });

  it('should serialize messages quickly', () => {
    const message = {
      jsonrpc: '2.0',
      id: 1,
      result: { tools: Array(50).fill({ name: 'tool', description: 'desc' }) },
    };

    const start = performance.now();

    for (let i = 0; i < 1000; i++) {
      serializeMessage(message);
    }

    const elapsed = performance.now() - start;
    const avgTime = elapsed / 1000;

    expect(avgTime).toBeLessThan(1);
  });
});
