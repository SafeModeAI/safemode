/**
 * Knob Gate
 *
 * Evaluates tool calls against knob configuration.
 * Determines allow/approve/block based on effect and knob settings.
 */

import type { ToolCallEffect, ToolCategory } from '../cet/types.js';
import type { KnobValue } from './categories.js';

// ============================================================================
// Types
// ============================================================================

export interface KnobResult {
  decision: 'allow' | 'approve' | 'block';
  knob: string;
  reason: string;
}

export interface KnobGateConfig {
  knobs: Record<string, KnobValue>;
  approveFallback: 'allow' | 'block';
}

// ============================================================================
// Action → Knob Mapping
// ============================================================================

/**
 * Maps (category, action) to the relevant knob name
 */
const ACTION_KNOB_MAP: Record<string, Record<string, string>> = {
  filesystem: {
    read: 'file_read',
    list: 'file_read',
    search: 'file_read',
    write: 'file_write',
    create: 'file_write',
    delete: 'file_delete',
  },
  terminal: {
    execute: 'command_exec',
    read: 'command_exec',
  },
  git: {
    read: 'git_read',
    write: 'git_commit',
    create: 'git_commit',
    delete: 'git_branch_delete',
  },
  network: {
    read: 'http_request',
    write: 'http_request',
  },
  database: {
    read: 'db_read',
    write: 'db_write',
    create: 'db_write',
    delete: 'db_delete',
  },
  financial: {
    read: 'payment_read',
    write: 'payment_create',
    create: 'payment_create',
    transfer: 'transfer',
  },
  communication: {
    read: 'message_read',
    write: 'message_send',
    create: 'message_send',
  },
  api: {
    read: 'api_read',
    write: 'api_write',
    create: 'api_write',
    delete: 'api_delete',
  },
  cloud: {
    read: 'cloud_read',
    write: 'instance_create',
    create: 'instance_create',
    delete: 'instance_delete',
  },
  container: {
    read: 'container_read',
    write: 'container_create',
    create: 'container_create',
    delete: 'container_delete',
    execute: 'container_exec',
  },
  package: {
    read: 'package_read',
    write: 'package_install',
    create: 'package_install',
    delete: 'package_uninstall',
  },
  scheduling: {
    read: 'schedule_read',
    write: 'cron_create',
    create: 'cron_create',
    delete: 'cron_delete',
  },
  authentication: {
    read: 'credential_read',
    write: 'credential_write',
    create: 'credential_write',
    delete: 'credential_delete',
  },
  deployment: {
    read: 'deployment_read',
    write: 'deploy_staging',
    create: 'deploy_staging',
  },
  monitoring: {
    read: 'log_read',
    write: 'log_write',
  },
  data: {
    read: 'data_read',
    write: 'data_export',
    create: 'data_import',
    delete: 'data_delete',
  },
  browser: {
    read: 'browser_read',
    write: 'form_submit',
    execute: 'navigate',
  },
  physical: {
    read: 'iot_read',
    write: 'iot_command',
    execute: 'hardware_control',
  },
};

// ============================================================================
// Knob Gate
// ============================================================================

export class KnobGate {
  private config: KnobGateConfig;

  constructor(config: KnobGateConfig) {
    this.config = config;
  }

  /**
   * Evaluate a tool call effect against knob configuration
   */
  evaluate(effect: ToolCallEffect): KnobResult {
    // Determine the relevant knob
    const knob = this.getKnobForEffect(effect);

    if (!knob) {
      // No specific knob found, use category-level defaults or fallback
      return this.evaluateFallback(effect);
    }

    // Get knob value
    const value = this.config.knobs[knob];

    if (!value) {
      // Knob not configured, use fallback
      return this.evaluateFallback(effect);
    }

    // Return decision based on knob value
    return {
      decision: value,
      knob,
      reason: this.getReasonForDecision(value, knob, effect),
    };
  }

  /**
   * Get the knob name for a given effect
   */
  private getKnobForEffect(effect: ToolCallEffect): string | null {
    const category = effect.category as ToolCategory;
    const actionMap = ACTION_KNOB_MAP[category];

    if (!actionMap) {
      return null;
    }

    const knob = actionMap[effect.action];
    return knob || null;
  }

  /**
   * Evaluate fallback when no specific knob applies
   */
  private evaluateFallback(effect: ToolCallEffect): KnobResult {
    // High/critical risk defaults to approve
    if (effect.risk === 'high' || effect.risk === 'critical') {
      return {
        decision: 'approve',
        knob: 'fallback',
        reason: `${effect.risk} risk action requires approval`,
      };
    }

    // Otherwise allow
    return {
      decision: 'allow',
      knob: 'fallback',
      reason: 'No specific knob configured, allowing by default',
    };
  }

  /**
   * Get human-readable reason for a decision
   */
  private getReasonForDecision(
    value: KnobValue,
    knob: string,
    effect: ToolCallEffect
  ): string {
    const actionDesc = `${effect.action} on ${effect.category}`;

    switch (value) {
      case 'allow':
        return `${actionDesc} is allowed (knob: ${knob})`;
      case 'approve':
        return `${actionDesc} requires approval (knob: ${knob})`;
      case 'block':
        return `${actionDesc} is blocked (knob: ${knob})`;
      default:
        return `Unknown decision for ${actionDesc}`;
    }
  }

  /**
   * Check if a specific action on a category is allowed
   */
  isAllowed(category: ToolCategory, action: string): boolean {
    const fakeEffect: ToolCallEffect = {
      action: action as ToolCallEffect['action'],
      target: '',
      scope: 'project',
      risk: 'low',
      category: category,
      confidence: 1.0,
      source: 'registry',
    };

    const result = this.evaluate(fakeEffect);
    return result.decision === 'allow';
  }

  /**
   * Update knob configuration
   */
  updateConfig(config: Partial<KnobGateConfig>): void {
    if (config.knobs) {
      this.config.knobs = { ...this.config.knobs, ...config.knobs };
    }
    if (config.approveFallback) {
      this.config.approveFallback = config.approveFallback;
    }
  }

  /**
   * Get current knob value
   */
  getKnobValue(knob: string): KnobValue | undefined {
    return this.config.knobs[knob];
  }

  /**
   * Set a single knob value
   */
  setKnobValue(knob: string, value: KnobValue): void {
    this.config.knobs[knob] = value;
  }
}
