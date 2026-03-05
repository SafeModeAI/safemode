/**
 * Telegram Approval Provider
 *
 * Sends approval requests via Telegram bot and waits for user response.
 */

// ============================================================================
// Types
// ============================================================================

export interface TelegramConfig {
  /** Bot token from @BotFather */
  botToken: string;

  /** Chat ID to send messages to */
  chatId: string;

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

  /** Who approved (telegram user) */
  approvedBy?: string;

  /** When the response was received */
  respondedAt: Date;

  /** Whether it timed out */
  timedOut: boolean;
}

// ============================================================================
// Telegram Provider
// ============================================================================

export class TelegramApprovalProvider {
  private config: TelegramConfig;
  private baseUrl: string;
  private pendingRequests: Map<string, {
    resolve: (response: ApprovalResponse) => void;
    timeout: NodeJS.Timeout;
  }> = new Map();
  private pollingActive = false;
  private lastUpdateId = 0;

  constructor(config: TelegramConfig) {
    this.config = {
      timeout: 60000, // Default 60 seconds
      ...config,
    };
    this.baseUrl = `https://api.telegram.org/bot${config.botToken}`;
  }

  /**
   * Send approval request and wait for response
   */
  async requestApproval(request: ApprovalRequest): Promise<ApprovalResponse> {
    // Build message
    const message = this.buildMessage(request);

    // Send message with inline keyboard
    const keyboard = {
      inline_keyboard: [
        [
          { text: '✅ Approve', callback_data: `approve:${request.requestId}` },
          { text: '❌ Deny', callback_data: `deny:${request.requestId}` },
        ],
      ],
    };

    try {
      await this.sendMessage(message, keyboard);
    } catch (error) {
      // If we can't send the message, fail closed (deny)
      return {
        approved: false,
        respondedAt: new Date(),
        timedOut: false,
      };
    }

    // Start polling if not already active
    this.startPolling();

    // Wait for response with timeout
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
   * Build approval message
   */
  private buildMessage(request: ApprovalRequest): string {
    const emoji = this.getRiskEmoji(request.riskLevel);
    const lines = [
      `${emoji} *Safe Mode Approval Request*`,
      '',
      `📌 *Tool:* \`${request.toolName}\``,
      `🔌 *Server:* \`${request.serverName}\``,
      `⚠️ *Risk:* ${request.riskLevel.toUpperCase()}`,
      '',
      `📝 *Action:*`,
      request.description,
    ];

    if (request.details) {
      lines.push('', '📋 *Details:*');
      for (const [key, value] of Object.entries(request.details)) {
        const valueStr = typeof value === 'string' ? value : JSON.stringify(value);
        lines.push(`  • ${key}: \`${this.escapeMarkdown(valueStr.slice(0, 100))}\``);
      }
    }

    lines.push('', `🆔 Request: \`${request.requestId}\``);

    return lines.join('\n');
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
   * Escape markdown special characters
   */
  private escapeMarkdown(text: string): string {
    return text.replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&');
  }

  /**
   * Send message to Telegram
   */
  private async sendMessage(
    text: string,
    replyMarkup?: Record<string, unknown>
  ): Promise<void> {
    const url = `${this.baseUrl}/sendMessage`;
    const body: Record<string, unknown> = {
      chat_id: this.config.chatId,
      text,
      parse_mode: 'Markdown',
    };

    if (replyMarkup) {
      body.reply_markup = JSON.stringify(replyMarkup);
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Telegram API error: ${response.statusText}`);
    }
  }

  /**
   * Start polling for updates
   */
  private startPolling(): void {
    if (this.pollingActive) return;
    this.pollingActive = true;
    this.pollUpdates();
  }

  /**
   * Stop polling
   */
  stopPolling(): void {
    this.pollingActive = false;
  }

  /**
   * Poll for updates
   */
  private async pollUpdates(): Promise<void> {
    while (this.pollingActive && this.pendingRequests.size > 0) {
      try {
        const url = `${this.baseUrl}/getUpdates?offset=${this.lastUpdateId + 1}&timeout=10`;
        const response = await fetch(url);
        const data = await response.json() as {
          ok: boolean;
          result: Array<{
            update_id: number;
            callback_query?: {
              id: string;
              from: { username?: string; first_name: string };
              data: string;
            };
          }>;
        };

        if (data.ok && data.result) {
          for (const update of data.result) {
            this.lastUpdateId = update.update_id;

            if (update.callback_query) {
              this.handleCallbackQuery(update.callback_query);
            }
          }
        }
      } catch {
        // Ignore polling errors
      }

      // Small delay between polls
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    this.pollingActive = false;
  }

  /**
   * Handle callback query (button press)
   */
  private handleCallbackQuery(query: {
    id: string;
    from: { username?: string; first_name: string };
    data: string;
  }): void {
    const [action, requestId] = query.data.split(':');
    const pending = this.pendingRequests.get(requestId || '');

    if (pending) {
      clearTimeout(pending.timeout);
      this.pendingRequests.delete(requestId || '');

      pending.resolve({
        approved: action === 'approve',
        approvedBy: query.from.username || query.from.first_name,
        respondedAt: new Date(),
        timedOut: false,
      });

      // Answer callback query
      this.answerCallbackQuery(query.id, action === 'approve' ? '✅ Approved' : '❌ Denied');
    }
  }

  /**
   * Answer callback query
   */
  private async answerCallbackQuery(queryId: string, text: string): Promise<void> {
    try {
      await fetch(`${this.baseUrl}/answerCallbackQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          callback_query_id: queryId,
          text,
        }),
      });
    } catch {
      // Ignore errors
    }
  }

  /**
   * Send a one-way notification (no approval needed)
   */
  async sendNotification(title: string, body: string): Promise<boolean> {
    try {
      await this.sendMessage(`*${title}*\n\n${body}`);
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
      await this.sendMessage('🔗 Safe Mode Telegram integration connected!');
      return true;
    } catch {
      return false;
    }
  }
}
