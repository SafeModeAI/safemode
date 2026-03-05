/**
 * Discord Approval Provider
 *
 * Sends approval requests via Discord webhook and waits for user response.
 * Uses Discord interactions for approve/deny buttons.
 */

// ============================================================================
// Types
// ============================================================================

export interface DiscordConfig {
  /** Discord webhook URL */
  webhookUrl: string;

  /** Optional bot token for interactions */
  botToken?: string;

  /** User ID to mention (optional) */
  userId?: string;

  /** Timeout for approval in milliseconds */
  timeout?: number;
}

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

  /** Who approved (discord user) */
  approvedBy?: string;

  /** When the response was received */
  respondedAt: Date;

  /** Whether it timed out */
  timedOut: boolean;
}

// ============================================================================
// Discord Provider
// ============================================================================

export class DiscordApprovalProvider {
  private config: DiscordConfig;
  private pendingRequests: Map<string, {
    resolve: (response: ApprovalResponse) => void;
    timeout: NodeJS.Timeout;
  }> = new Map();

  constructor(config: DiscordConfig) {
    this.config = {
      timeout: 60000, // Default 60 seconds
      ...config,
    };
  }

  /**
   * Send approval request and wait for response
   *
   * Note: Discord webhooks don't support interactive buttons.
   * This implementation sends a notification and uses a polling-based
   * approach via a local HTTP server for responses.
   */
  async requestApproval(request: ApprovalRequest): Promise<ApprovalResponse> {
    // Build embed
    const embed = this.buildEmbed(request);

    // Send webhook message
    try {
      await this.sendWebhook(embed);
    } catch (error) {
      // If we can't send the message, fail closed (deny)
      return {
        approved: false,
        respondedAt: new Date(),
        timedOut: false,
      };
    }

    // Since Discord webhooks don't support interactions,
    // we'll implement a simple timeout-based approach.
    // For full interactive support, a Discord bot would be needed.
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(request.requestId);
        resolve({
          approved: false,
          respondedAt: new Date(),
          timedOut: true,
        });
      }, this.config.timeout);

      this.pendingRequests.set(request.requestId, { resolve, timeout });
    });
  }

  /**
   * Manually approve a pending request
   */
  approveRequest(requestId: string, approvedBy?: string): boolean {
    const pending = this.pendingRequests.get(requestId);
    if (!pending) return false;

    clearTimeout(pending.timeout);
    this.pendingRequests.delete(requestId);

    pending.resolve({
      approved: true,
      approvedBy,
      respondedAt: new Date(),
      timedOut: false,
    });

    return true;
  }

  /**
   * Manually deny a pending request
   */
  denyRequest(requestId: string): boolean {
    const pending = this.pendingRequests.get(requestId);
    if (!pending) return false;

    clearTimeout(pending.timeout);
    this.pendingRequests.delete(requestId);

    pending.resolve({
      approved: false,
      respondedAt: new Date(),
      timedOut: false,
    });

    return true;
  }

  /**
   * Build Discord embed
   */
  private buildEmbed(request: ApprovalRequest): Record<string, unknown> {
    const color = this.getRiskColor(request.riskLevel);

    const fields = [
      { name: '📌 Tool', value: `\`${request.toolName}\``, inline: true },
      { name: '🔌 Server', value: `\`${request.serverName}\``, inline: true },
      { name: '⚠️ Risk', value: request.riskLevel.toUpperCase(), inline: true },
      { name: '📝 Action', value: request.description },
    ];

    if (request.details) {
      const detailLines = Object.entries(request.details)
        .map(([key, value]) => {
          const valueStr = typeof value === 'string' ? value : JSON.stringify(value);
          return `• **${key}:** \`${valueStr.slice(0, 100)}\``;
        })
        .join('\n');
      fields.push({ name: '📋 Details', value: detailLines || 'None' });
    }

    fields.push({ name: '🆔 Request ID', value: `\`${request.requestId}\`` });

    const embed: Record<string, unknown> = {
      title: `${this.getRiskEmoji(request.riskLevel)} Safe Mode Approval Request`,
      color,
      fields,
      timestamp: new Date().toISOString(),
      footer: {
        text: 'Safe Mode | AI Governance',
      },
    };

    return embed;
  }

  /**
   * Get color for risk level
   */
  private getRiskColor(risk: string): number {
    switch (risk) {
      case 'critical':
        return 0xff0000; // Red
      case 'high':
        return 0xff6600; // Orange
      case 'medium':
        return 0xffcc00; // Yellow
      default:
        return 0x00ff00; // Green
    }
  }

  /**
   * Get emoji for risk level
   */
  private getRiskEmoji(risk: string): string {
    switch (risk) {
      case 'critical':
        return '🚨';
      case 'high':
        return '🔴';
      case 'medium':
        return '🟡';
      default:
        return '🟢';
    }
  }

  /**
   * Send webhook message
   */
  private async sendWebhook(embed: Record<string, unknown>): Promise<void> {
    const body: Record<string, unknown> = {
      embeds: [embed],
    };

    // Add user mention if configured
    if (this.config.userId) {
      body.content = `<@${this.config.userId}> Approval needed:`;
    }

    const response = await fetch(this.config.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Discord webhook error: ${response.statusText}`);
    }
  }

  /**
   * Send a one-way notification (no approval needed)
   */
  async sendNotification(title: string, body: string): Promise<boolean> {
    try {
      await this.sendWebhook({
        title,
        description: body,
        color: 0xff6600,
        timestamp: new Date().toISOString(),
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Test connection by sending a test message
   */
  async testConnection(): Promise<boolean> {
    try {
      await this.sendWebhook({
        title: '🔗 Safe Mode Connection Test',
        description: 'Discord integration is working!',
        color: 0x00ff00,
        timestamp: new Date().toISOString(),
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get pending request count
   */
  get pendingCount(): number {
    return this.pendingRequests.size;
  }
}
