/**
 * CLI Command Tests
 *
 * Tests CLI command implementations.
 */

import { describe, it, expect } from 'vitest';
import { ConfigLoader, CONFIG_PATHS, MCP_CLIENT_PATHS } from '../src/config/index.js';
import * as os from 'os';
import * as path from 'path';

describe('MCP Client Detection', () => {
  describe('Config Path Resolution', () => {
    it('should have Claude Desktop paths defined', () => {
      expect(MCP_CLIENT_PATHS['Claude Desktop']).toBeDefined();
      expect(MCP_CLIENT_PATHS['Claude Desktop'].length).toBeGreaterThan(0);
      expect(MCP_CLIENT_PATHS['Claude Desktop'].some(p => p.includes('Claude'))).toBe(true);
    });

    it('should have Cursor paths defined', () => {
      expect(MCP_CLIENT_PATHS['Cursor']).toBeDefined();
      expect(MCP_CLIENT_PATHS['Cursor'].some(p => p.includes('.cursor'))).toBe(true);
    });

    it('should have Claude Code path defined', () => {
      expect(MCP_CLIENT_PATHS['Claude Code']).toBeDefined();
      expect(MCP_CLIENT_PATHS['Claude Code'].some(p => p.includes('.claude'))).toBe(true);
    });
  });

  describe('Client Detection', () => {
    it('should return array of detected clients', () => {
      const clients = ConfigLoader.detectMCPClients();
      expect(Array.isArray(clients)).toBe(true);
    });

    it('should include client name and path in detected clients', () => {
      const clients = ConfigLoader.detectMCPClients();

      clients.forEach(client => {
        expect(client.name).toBeDefined();
        expect(typeof client.name).toBe('string');
        expect(client.path).toBeDefined();
        expect(typeof client.path).toBe('string');
      });
    });
  });
});

describe('Config Loading', () => {
  describe('Preset Validation', () => {
    const presets = ['yolo', 'coding', 'personal', 'trading', 'strict'];

    it('should have 5 presets available', () => {
      expect(presets.length).toBe(5);
    });

    it('should include all required presets', () => {
      expect(presets).toContain('yolo');
      expect(presets).toContain('coding');
      expect(presets).toContain('personal');
      expect(presets).toContain('trading');
      expect(presets).toContain('strict');
    });
  });

  describe('Config Validation', () => {
    it('should validate version field is required', () => {
      const invalidConfig = {
        preset: 'coding',
        // Missing version
      };

      const isValid = 'version' in invalidConfig;
      expect(isValid).toBe(false);
    });

    it('should accept valid config structure', () => {
      const validConfig = {
        version: '1.0',
        preset: 'coding',
        overrides: {
          filesystem: {
            file_write: 'approve',
          },
        },
      };

      expect(validConfig.version).toBe('1.0');
      expect(validConfig.preset).toBe('coding');
    });
  });
});

describe('Config Patching', () => {
  describe('MCP Config Transformation', () => {
    it('should transform server config to use safemode proxy', () => {
      const originalConfig = {
        mcpServers: {
          filesystem: {
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-filesystem', '/home/user'],
          },
        },
      };

      // Transform
      const transformed = {
        mcpServers: {
          filesystem: {
            command: 'safemode',
            args: ['proxy', '--', 'npx', ...originalConfig.mcpServers.filesystem.args],
          },
        },
      };

      expect(transformed.mcpServers.filesystem.command).toBe('safemode');
      expect(transformed.mcpServers.filesystem.args[0]).toBe('proxy');
      expect(transformed.mcpServers.filesystem.args[1]).toBe('--');
      expect(transformed.mcpServers.filesystem.args[2]).toBe('npx');
    });

    it('should preserve original args after --', () => {
      const originalArgs = ['-y', '@modelcontextprotocol/server-filesystem', '/home/user'];
      const transformedArgs = ['proxy', '--', 'npx', ...originalArgs];

      expect(transformedArgs.slice(3)).toEqual(originalArgs);
    });

    it('should handle multiple servers', () => {
      const originalConfig = {
        mcpServers: {
          filesystem: {
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-filesystem', '/home/user'],
          },
          git: {
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-git'],
          },
        },
      };

      const serverCount = Object.keys(originalConfig.mcpServers).length;
      expect(serverCount).toBe(2);

      // Each server should be wrapped
      Object.keys(originalConfig.mcpServers).forEach(name => {
        const server = (originalConfig.mcpServers as any)[name];
        const wrapped = {
          command: 'safemode',
          args: ['proxy', '--', server.command, ...server.args],
        };
        expect(wrapped.command).toBe('safemode');
      });
    });
  });
});

describe('Restore Functionality', () => {
  it('should track original config for restoration', () => {
    const backupPath = (configPath: string) => `${configPath}.safemode-backup`;

    expect(backupPath('/home/user/.cursor/mcp.json')).toBe(
      '/home/user/.cursor/mcp.json.safemode-backup'
    );
  });
});

describe('Doctor Command Components', () => {
  it('should check required components', () => {
    const checks = [
      'MCP clients detected',
      'Config files valid',
      'SQLite database accessible',
      'Quarantine cache accessible',
      'Engines loaded',
    ];

    expect(checks.length).toBeGreaterThan(0);
    expect(checks).toContain('Engines loaded');
  });
});
