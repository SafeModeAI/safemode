/**
 * Notification System
 *
 * Sends desktop notifications and writes to activity feed.
 * Supports different severity levels for filtering.
 */

import notifier from 'node-notifier';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { CONFIG_PATHS } from '../config/index.js';

// ============================================================================
// Types
// ============================================================================

export type Severity = 'info' | 'low' | 'medium' | 'high' | 'critical';

export interface NotificationConfig {
  /** Enable desktop notifications */
  desktopEnabled: boolean;

  /** Minimum severity for desktop notifications */
  desktopMinSeverity: Severity;

  /** Enable activity feed logging */
  activityFeedEnabled: boolean;

  /** Activity feed file path */
  activityFeedPath?: string;

  /** Maximum activity feed entries */
  maxActivityEntries: number;
}

export interface ActivityEntry {
  timestamp: string;
  severity: Severity;
  message: string;
  source?: string;
}

// ============================================================================
// Default Config
// ============================================================================

const DEFAULT_CONFIG: NotificationConfig = {
  desktopEnabled: true,
  desktopMinSeverity: 'medium',
  activityFeedEnabled: true,
  maxActivityEntries: 1000,
};

// Severity ordering
const SEVERITY_ORDER: Record<Severity, number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

// ============================================================================
// Notification Manager
// ============================================================================

export class NotificationManager {
  private config: NotificationConfig;
  private activityFeedPath: string;
  private activityEntries: ActivityEntry[] = [];
  private loaded = false;

  constructor(config: Partial<NotificationConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.activityFeedPath =
      config.activityFeedPath || path.join(CONFIG_PATHS.safemodeDir, 'activity.json');
  }

  /**
   * Send a notification
   */
  notify(severity: Severity, message: string, source?: string): void {
    // Always log to activity feed
    if (this.config.activityFeedEnabled) {
      this.logActivity(severity, message, source);
    }

    // Send desktop notification if enabled and severity meets threshold
    if (
      this.config.desktopEnabled &&
      SEVERITY_ORDER[severity] >= SEVERITY_ORDER[this.config.desktopMinSeverity]
    ) {
      this.sendDesktopNotification(severity, message);
    }

    // Also log to stderr for proxy visibility
    const icon = this.getSeverityIcon(severity);
    process.stderr.write(`[Safe Mode] ${icon} ${severity.toUpperCase()}: ${message}\n`);
  }

  /**
   * Send a desktop notification
   */
  private sendDesktopNotification(severity: Severity, message: string): void {
    try {
      notifier.notify({
        title: `Safe Mode - ${severity.toUpperCase()}`,
        message: this.truncate(message, 200),
        sound: severity === 'critical' || severity === 'high',
        wait: false,
        timeout: severity === 'critical' ? 10 : 5,
      });
    } catch (error) {
      // Notification failure should not break the proxy
      process.stderr.write(
        `[Safe Mode] Notification error: ${(error as Error).message}\n`
      );
    }
  }

  /**
   * Log an activity entry
   */
  private logActivity(severity: Severity, message: string, source?: string): void {
    const entry: ActivityEntry = {
      timestamp: new Date().toISOString(),
      severity,
      message,
      source,
    };

    // Ensure loaded
    if (!this.loaded) {
      this.loadActivityFeed();
    }

    this.activityEntries.push(entry);

    // Trim to max entries
    if (this.activityEntries.length > this.config.maxActivityEntries) {
      this.activityEntries = this.activityEntries.slice(-this.config.maxActivityEntries);
    }

    // Persist
    this.saveActivityFeed();
  }

  /**
   * Get recent activity entries
   */
  getRecentActivity(limit: number = 50, minSeverity?: Severity): ActivityEntry[] {
    if (!this.loaded) {
      this.loadActivityFeed();
    }

    let entries = this.activityEntries.slice(-limit).reverse();

    if (minSeverity) {
      entries = entries.filter(
        (e) => SEVERITY_ORDER[e.severity] >= SEVERITY_ORDER[minSeverity]
      );
    }

    return entries;
  }

  /**
   * Clear activity feed
   */
  clearActivity(): void {
    this.activityEntries = [];
    this.saveActivityFeed();
  }

  /**
   * Load activity feed from disk
   */
  private loadActivityFeed(): void {
    try {
      if (fs.existsSync(this.activityFeedPath)) {
        const content = fs.readFileSync(this.activityFeedPath, 'utf8');
        this.activityEntries = JSON.parse(content);
      }
    } catch {
      this.activityEntries = [];
    }
    this.loaded = true;
  }

  /**
   * Save activity feed to disk
   */
  private saveActivityFeed(): void {
    try {
      const dir = path.dirname(this.activityFeedPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.activityFeedPath, JSON.stringify(this.activityEntries, null, 2));
    } catch {
      // Silently fail - don't break the proxy
    }
  }

  /**
   * Get icon for severity
   */
  private getSeverityIcon(severity: Severity): string {
    switch (severity) {
      case 'info':
        return 'ℹ️';
      case 'low':
        return '📝';
      case 'medium':
        return '⚠️';
      case 'high':
        return '🔶';
      case 'critical':
        return '🚨';
      default:
        return '•';
    }
  }

  /**
   * Truncate message
   */
  private truncate(str: string, maxLen: number): string {
    return str.length > maxLen ? str.slice(0, maxLen - 3) + '...' : str;
  }

  /**
   * Update config
   */
  updateConfig(config: Partial<NotificationConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let notificationInstance: NotificationManager | null = null;

export function getNotificationManager(
  config?: Partial<NotificationConfig>
): NotificationManager {
  if (!notificationInstance) {
    notificationInstance = new NotificationManager(config);
  }
  return notificationInstance;
}
