/**
 * ATSP (Adaptive Tool Schema Projection) Tests
 *
 * Tests schema rewriting with REPLACE-NEVER-APPEND principle.
 */

import { describe, it, expect } from 'vitest';
import { ATSPEngine, createATSPConfig, type CapabilityLevel } from '../src/atsp/index.js';
import type { MCPTool } from '../src/proxy/protocol.js';

// Helper to create ATSPEngine with specific levels
function createEngine(
  levels: Partial<Record<string, CapabilityLevel>>,
  projectDir = '/home/user/project'
) {
  const config = {
    levels: levels as any,
    projectDir,
    allowedPaths: [],
    knobs: {},
  };
  return new ATSPEngine(config);
}

// Helper to create tool
function createTool(name: string, description: string): MCPTool {
  return {
    name,
    description,
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'The file path' },
      },
    },
  };
}

describe('ATSP Engine', () => {
  describe('Disabled Capability', () => {
    it('should remove tool entirely when category is disabled', () => {
      const engine = createEngine({ terminal: 'disabled', filesystem: 'full_access' });
      const tools: MCPTool[] = [
        createTool('execute_command', 'Run shell commands'),
        createTool('read_file', 'Read files'),
      ];

      const result = engine.rewrite(tools);

      expect(result.length).toBe(1);
      expect(result[0].name).toBe('read_file');
    });
  });

  describe('ReadOnly Capability', () => {
    it('should remove write operations when read_only', () => {
      const engine = createEngine({ filesystem: 'read_only' });
      const tools: MCPTool[] = [
        createTool('read_file', 'Read files'),
        createTool('write_file', 'Write files'),
        createTool('delete_file', 'Delete files'),
      ];

      const result = engine.rewrite(tools);

      expect(result.length).toBe(1);
      expect(result[0].name).toBe('read_file');
    });

    it('should keep read operations in read_only mode', () => {
      const engine = createEngine({ filesystem: 'read_only' });
      const tools: MCPTool[] = [
        createTool('list_directory', 'List directory contents'),
        createTool('get_file_info', 'Get file information'),
        createTool('write_file', 'Write to a file'),
      ];

      const result = engine.rewrite(tools);

      // list_directory and get_file_info should be kept, write_file removed
      const names = result.map(t => t.name);
      expect(names).toContain('list_directory');
      expect(names).not.toContain('write_file');
    });
  });

  describe('ScopedWrite Capability', () => {
    it('should constrain write paths to project directory', () => {
      const engine = createEngine({ filesystem: 'scoped_write' });
      const tools: MCPTool[] = [
        {
          name: 'write_file',
          description: 'Write content to any file on the system',
          inputSchema: {
            type: 'object',
            properties: {
              path: {
                type: 'string',
                description: 'Absolute or relative path',
              },
              content: { type: 'string' },
            },
          },
        },
      ];

      const result = engine.rewrite(tools);

      expect(result.length).toBe(1);
      const schema = result[0].inputSchema as any;
      // Should have pattern constraint
      expect(schema.properties.path.pattern).toBeDefined();
      // Description should be replaced, not appended
      expect(schema.properties.path.description).not.toContain('any file');
    });
  });

  describe('FullAccess Capability', () => {
    it('should pass through tools with only hardcoded invariants', () => {
      const engine = createEngine({ terminal: 'full_access' });
      const originalTool: MCPTool = {
        name: 'execute_command',
        description: 'Execute any shell command',
        inputSchema: {
          type: 'object',
          properties: {
            command: {
              type: 'string',
              description: 'The command to run',
            },
          },
        },
      };

      const result = engine.rewrite([originalTool]);

      expect(result.length).toBe(1);
      // Tool should exist but may have sanitized schema
    });
  });

  describe('REPLACE-NEVER-APPEND Principle', () => {
    it('should never append warnings to descriptions', () => {
      const engine = createEngine({ filesystem: 'scoped_write' });
      const tools: MCPTool[] = [
        {
          name: 'write_file',
          description: 'Write any file',
          inputSchema: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'File path' },
            },
          },
        },
      ];

      const result = engine.rewrite(tools);

      // Should not contain warning phrases
      const desc = result[0].description?.toLowerCase() || '';
      expect(desc).not.toContain('warning');
      expect(desc).not.toContain('caution');
      expect(desc).not.toContain('do not');
    });

    it('should modify descriptions for scoped write capability', () => {
      const engine = createEngine({ filesystem: 'scoped_write' });
      const tools: MCPTool[] = [
        {
          name: 'write_file',
          description: 'Write any file on the filesystem',
          inputSchema: {
            type: 'object',
            properties: {
              filepath: { type: 'string' },
            },
          },
        },
      ];

      const result = engine.rewrite(tools);

      // Description should be modified to reflect project scope
      const desc = result[0].description?.toLowerCase() || '';
      // The implementation replaces "any file" and "the filesystem" patterns
      // At minimum, "filesystem" should be replaced with "project directory"
      expect(desc).toContain('project directory');
    });
  });

  describe('Multiple Categories', () => {
    it('should handle mixed capability levels', () => {
      const engine = createEngine({
        filesystem: 'read_only',
        terminal: 'disabled',
        git: 'scoped_write',
      });

      const tools: MCPTool[] = [
        createTool('read_file', 'Read files'),
        createTool('write_file', 'Write files'),
        createTool('execute_command', 'Run commands'),
        createTool('git_push', 'Push to remote'),
      ];

      const result = engine.rewrite(tools);

      const names = result.map(t => t.name);
      expect(names).toContain('read_file');
      expect(names).not.toContain('write_file');
      expect(names).not.toContain('execute_command');
      expect(names).toContain('git_push');
    });
  });

  describe('Performance', () => {
    it('should process 500 tools in <50ms', () => {
      const engine = createEngine({ filesystem: 'read_only' });
      const tools: MCPTool[] = Array(500).fill(null).map((_, i) => ({
        name: `tool_${i}`,
        description: `Tool number ${i}`,
        inputSchema: { type: 'object', properties: {} },
      }));

      const start = performance.now();
      engine.rewrite(tools);
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(50);
    });
  });

  describe('Category Detection', () => {
    it('should correctly categorize filesystem tools', () => {
      const engine = createEngine({ filesystem: 'disabled' });
      const tools: MCPTool[] = [
        createTool('read_file', 'Read a file'),
        createTool('write_file', 'Write a file'),
      ];

      const result = engine.rewrite(tools);

      // Both should be removed as filesystem tools
      expect(result.length).toBe(0);
    });

    it('should correctly categorize git tools', () => {
      const engine = createEngine({ git: 'disabled' });
      const tools: MCPTool[] = [
        createTool('git_status', 'Show git status'),
        createTool('git_commit', 'Create commit'),
        createTool('git_push', 'Push to remote'),
      ];

      const result = engine.rewrite(tools);

      // All git tools should be removed when git is disabled
      expect(result.length).toBe(0);
    });
  });

  describe('createATSPConfig', () => {
    it('should create config from preset name', () => {
      const config = createATSPConfig('coding', {});

      expect(config.levels.filesystem).toBe('scoped_write');
      expect(config.levels.terminal).toBe('scoped_write');
    });

    it('should create strict config', () => {
      const config = createATSPConfig('strict', {});

      expect(config.levels.filesystem).toBe('read_only');
      expect(config.levels.terminal).toBe('disabled');
    });
  });
});
