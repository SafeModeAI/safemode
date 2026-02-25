/**
 * Approvals Module Tests
 *
 * Tests approval manager and provider configuration.
 */

import { describe, it, expect } from 'vitest';
import { ApprovalManager, type ApprovalManagerConfig, type ApprovalRequest } from '../src/approvals/manager.js';

describe('Approval Manager', () => {
  describe('Configuration', () => {
    it('should create manager with default config', () => {
      const config: ApprovalManagerConfig = {
        fallbackBehavior: 'block',
        minRiskLevel: 'high',
      };

      const manager = new ApprovalManager(config);

      expect(manager.hasProviders()).toBe(false);
      expect(manager.getProviders()).toEqual([]);
    });

    it('should register telegram provider when configured', () => {
      const config: ApprovalManagerConfig = {
        telegram: {
          botToken: 'test-token',
          chatId: '12345',
        },
        fallbackBehavior: 'block',
        minRiskLevel: 'high',
      };

      const manager = new ApprovalManager(config);

      expect(manager.hasProviders()).toBe(true);
      expect(manager.getProviders()).toContain('telegram');
    });

    it('should register discord provider when configured', () => {
      const config: ApprovalManagerConfig = {
        discord: {
          webhookUrl: 'https://discord.com/api/webhooks/test',
        },
        fallbackBehavior: 'block',
        minRiskLevel: 'high',
      };

      const manager = new ApprovalManager(config);

      expect(manager.hasProviders()).toBe(true);
      expect(manager.getProviders()).toContain('discord');
    });
  });

  describe('Risk Level Filtering', () => {
    it('should require approval for risks at or above threshold', () => {
      const manager = new ApprovalManager({
        fallbackBehavior: 'block',
        minRiskLevel: 'high',
      });

      expect(manager.requiresApproval('critical')).toBe(true);
      expect(manager.requiresApproval('high')).toBe(true);
      expect(manager.requiresApproval('medium')).toBe(false);
      expect(manager.requiresApproval('low')).toBe(false);
    });

    it('should require approval for all risks when minRiskLevel is low', () => {
      const manager = new ApprovalManager({
        fallbackBehavior: 'block',
        minRiskLevel: 'low',
      });

      expect(manager.requiresApproval('critical')).toBe(true);
      expect(manager.requiresApproval('high')).toBe(true);
      expect(manager.requiresApproval('medium')).toBe(true);
      expect(manager.requiresApproval('low')).toBe(true);
    });
  });

  describe('Fallback Behavior', () => {
    it('should block when fallback is block and no providers', async () => {
      const manager = new ApprovalManager({
        fallbackBehavior: 'block',
        minRiskLevel: 'high',
      });

      const request: ApprovalRequest = {
        requestId: 'req-1',
        toolName: 'dangerous_tool',
        serverName: 'test',
        riskLevel: 'critical',
        description: 'Test request',
      };

      const response = await manager.requestApproval(request);

      expect(response.approved).toBe(false);
      expect(response.provider).toBe('local');
    });

    it('should allow when fallback is allow and no providers', async () => {
      const manager = new ApprovalManager({
        fallbackBehavior: 'allow',
        minRiskLevel: 'high',
      });

      const request: ApprovalRequest = {
        requestId: 'req-1',
        toolName: 'dangerous_tool',
        serverName: 'test',
        riskLevel: 'critical',
        description: 'Test request',
      };

      const response = await manager.requestApproval(request);

      expect(response.approved).toBe(true);
      expect(response.provider).toBe('local');
    });

    it('should auto-approve low risk requests', async () => {
      const manager = new ApprovalManager({
        fallbackBehavior: 'block',
        minRiskLevel: 'high',
      });

      const request: ApprovalRequest = {
        requestId: 'req-1',
        toolName: 'read_file',
        serverName: 'test',
        riskLevel: 'low',
        description: 'Test request',
      };

      const response = await manager.requestApproval(request);

      expect(response.approved).toBe(true);
      expect(response.provider).toBe('local');
    });
  });

  describe('Local Approval', () => {
    it('should handle local approve', () => {
      const manager = new ApprovalManager({
        fallbackBehavior: 'prompt',
        minRiskLevel: 'high',
        defaultTimeout: 60000,
      });

      // Note: prompt fallback is async and stores pending request
      // Since we don't have actual pending requests without calling requestApproval,
      // we test that the method exists and returns false for non-existent request
      const result = manager.approveLocal('non-existent');
      expect(result).toBe(false);
    });

    it('should handle local deny', () => {
      const manager = new ApprovalManager({
        fallbackBehavior: 'prompt',
        minRiskLevel: 'high',
      });

      const result = manager.denyLocal('non-existent');
      expect(result).toBe(false);
    });

    it('should return empty pending requests when none exist', () => {
      const manager = new ApprovalManager({
        fallbackBehavior: 'block',
        minRiskLevel: 'high',
      });

      const pending = manager.getPendingRequests();
      expect(pending).toEqual([]);
    });
  });

  describe('Cleanup', () => {
    it('should stop cleanly', () => {
      const manager = new ApprovalManager({
        telegram: {
          botToken: 'test',
          chatId: '123',
        },
        fallbackBehavior: 'block',
        minRiskLevel: 'high',
      });

      // Should not throw
      expect(() => manager.stop()).not.toThrow();
    });
  });
});
