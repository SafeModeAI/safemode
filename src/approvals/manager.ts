/**
 * Approval Manager
 *
 * Manages approval requests across multiple providers (Telegram, Discord).
 * Handles fallback behavior and approval flow.
 */

import { TelegramApprovalProvider, type TelegramConfig } from './telegram.js';
import { DiscordApprovalProvider, type DiscordConfig } from './discord.js';

// ============================================================================
// Types
// ============================================================================

export interface ApprovalRequest {
  /** Unique request ID */
  requestId: string;

  /** Tool being called */
  toolName: string;

  /** MCP server name */
  serverName: string;

  /** Risk level */
  riskLevel: 'low' | 'medium' | 'high' | 'critical';

  /** Human-readable description */
  description: string;

  /** Additional details */
  details?: Record<string, unknown>;
}

export interface ApprovalResponse {
  /** Whether the action was approved */
  approved: boolean;

  /** Which provider responded */
  provider?: 'telegram' | 'discord' | 'local';

  /** Who approved */
  approvedBy?: string;

  /** When the response was received */
  respondedAt: Date;

  /** Whether it timed out */
  timedOut: boolean;

  /** Error if any */
  error?: string;
}

export interface ApprovalManagerConfig {
  /** Telegram configuration */
  telegram?: TelegramConfig;

  /** Discord configuration */
  discord?: DiscordConfig;

  /** Default timeout in milliseconds */
  defaultTimeout?: number;

  /** Fallback behavior when providers unavailable */
  fallbackBehavior: 'block' | 'allow' | 'prompt';

  /** Minimum risk level to require approval */
  minRiskLevel: 'low' | 'medium' | 'high' | 'critical';
}

// ============================================================================
// Approval Manager
// ============================================================================

export class ApprovalManager {
  private telegram?: TelegramApprovalProvider;
  private discord?: DiscordApprovalProvider;
  private config: ApprovalManagerConfig;
  private localPendingRequests: Map<string, {
    resolve: (response: ApprovalResponse) => void;
    request: ApprovalRequest;
  }> = new Map();

  constructor(config: ApprovalManagerConfig) {
    this.config = {
      defaultTimeout: 60000,
      ...config,
    };

    // Initialize providers
    if (config.telegram) {
      this.telegram = new TelegramApprovalProvider(config.telegram);
    }

    if (config.discord) {
      this.discord = new DiscordApprovalProvider(config.discord);
    }
  }

  /**
   * Check if approval is required for this risk level
   */
  requiresApproval(riskLevel: 'low' | 'medium' | 'high' | 'critical'): boolean {
    const riskOrder = { low: 0, medium: 1, high: 2, critical: 3 };
    return riskOrder[riskLevel] >= riskOrder[this.config.minRiskLevel];
  }

  /**
   * Request approval via configured providers
   */
  async requestApproval(request: ApprovalRequest): Promise<ApprovalResponse> {
    // Check if approval is required
    if (!this.requiresApproval(request.riskLevel)) {
      return {
        approved: true,
        provider: 'local',
        respondedAt: new Date(),
        timedOut: false,
      };
    }

    // Try Telegram first if configured
    if (this.telegram) {
      try {
        const response = await this.telegram.requestApproval(request);
        return {
          ...response,
          provider: 'telegram',
        };
      } catch (error) {
        // Fall through to next provider
      }
    }

    // Try Discord if configured
    if (this.discord) {
      try {
        const response = await this.discord.requestApproval(request);
        return {
          ...response,
          provider: 'discord',
        };
      } catch (error) {
        // Fall through to fallback
      }
    }

    // No providers available - use fallback behavior
    return this.handleFallback(request);
  }

  /**
   * Handle fallback when no providers available
   */
  private handleFallback(request: ApprovalRequest): ApprovalResponse {
    switch (this.config.fallbackBehavior) {
      case 'allow':
        return {
          approved: true,
          provider: 'local',
          respondedAt: new Date(),
          timedOut: false,
        };

      case 'block':
        return {
          approved: false,
          provider: 'local',
          respondedAt: new Date(),
          timedOut: false,
          error: 'No approval providers available',
        };

      case 'prompt':
        // Store for local approval
        return new Promise((resolve) => {
          this.localPendingRequests.set(request.requestId, {
            resolve: (response) => resolve(response),
            request,
          });

          // Set timeout
          setTimeout(() => {
            const pending = this.localPendingRequests.get(request.requestId);
            if (pending) {
              this.localPendingRequests.delete(request.requestId);
              pending.resolve({
                approved: false,
                provider: 'local',
                respondedAt: new Date(),
                timedOut: true,
              });
            }
          }, this.config.defaultTimeout);
        }) as unknown as ApprovalResponse;
    }
  }

  /**
   * Locally approve a pending request
   */
  approveLocal(requestId: string, approvedBy?: string): boolean {
    const pending = this.localPendingRequests.get(requestId);
    if (!pending) return false;

    this.localPendingRequests.delete(requestId);
    pending.resolve({
      approved: true,
      provider: 'local',
      approvedBy,
      respondedAt: new Date(),
      timedOut: false,
    });

    return true;
  }

  /**
   * Locally deny a pending request
   */
  denyLocal(requestId: string): boolean {
    const pending = this.localPendingRequests.get(requestId);
    if (!pending) return false;

    this.localPendingRequests.delete(requestId);
    pending.resolve({
      approved: false,
      provider: 'local',
      respondedAt: new Date(),
      timedOut: false,
    });

    return true;
  }

  /**
   * Get pending local requests
   */
  getPendingRequests(): ApprovalRequest[] {
    return Array.from(this.localPendingRequests.values()).map((p) => p.request);
  }

  /**
   * Test all configured providers
   */
  async testConnections(): Promise<Record<string, boolean>> {
    const results: Record<string, boolean> = {};

    if (this.telegram) {
      results.telegram = await this.telegram.testConnection();
    }

    if (this.discord) {
      results.discord = await this.discord.testConnection();
    }

    return results;
  }

  /**
   * Check if any providers are configured
   */
  hasProviders(): boolean {
    return !!this.telegram || !!this.discord;
  }

  /**
   * Get configured providers
   */
  getProviders(): string[] {
    const providers: string[] = [];
    if (this.telegram) providers.push('telegram');
    if (this.discord) providers.push('discord');
    return providers;
  }

  /**
   * Stop all polling (cleanup)
   */
  stop(): void {
    if (this.telegram) {
      this.telegram.stopPolling();
    }
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let _approvalManager: ApprovalManager | null = null;

export function getApprovalManager(config?: ApprovalManagerConfig): ApprovalManager {
  if (!_approvalManager && config) {
    _approvalManager = new ApprovalManager(config);
  }
  if (!_approvalManager) {
    // Create with default config (block fallback, require high risk)
    _approvalManager = new ApprovalManager({
      fallbackBehavior: 'block',
      minRiskLevel: 'high',
    });
  }
  return _approvalManager;
}

export function configureApprovalManager(config: ApprovalManagerConfig): void {
  _approvalManager = new ApprovalManager(config);
}
