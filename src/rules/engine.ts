/**
 * Rules Engine
 *
 * Evaluates custom rules defined in YAML configuration.
 * Supports pattern matching, conditions, and actions.
 */

import type { ToolCallEffect } from '../cet/types.js';

// ============================================================================
// Types
// ============================================================================

export type RuleAction = 'allow' | 'block' | 'alert' | 'approve';

export interface RuleCondition {
  /** Field to match (tool_name, server_name, action, scope, risk, category, param.*) */
  field: string;

  /** Operator for comparison */
  operator: 'equals' | 'contains' | 'matches' | 'starts_with' | 'ends_with' | 'in' | 'not_in' | 'gt' | 'lt' | 'gte' | 'lte';

  /** Value to compare against */
  value: string | number | string[];

  /** Case insensitive matching */
  ignoreCase?: boolean;
}

export interface Rule {
  /** Unique rule ID */
  id: string;

  /** Human-readable name */
  name: string;

  /** Rule description */
  description?: string;

  /** Whether rule is enabled */
  enabled: boolean;

  /** Priority (lower = higher priority) */
  priority: number;

  /** Conditions (all must match) */
  conditions: RuleCondition[];

  /** Action to take when matched */
  action: RuleAction;

  /** Severity of the match */
  severity?: 'info' | 'low' | 'medium' | 'high' | 'critical';

  /** Message to display on match */
  message?: string;

  /** Whether to stop processing after this rule */
  stopOnMatch?: boolean;
}

export interface RuleEvaluationContext {
  /** Tool name */
  toolName: string;

  /** Server name */
  serverName: string;

  /** Tool parameters */
  parameters: Record<string, unknown>;

  /** CET effect */
  effect: ToolCallEffect;
}

export interface RuleMatch {
  /** Rule that matched */
  rule: Rule;

  /** Action to take */
  action: RuleAction;

  /** Severity */
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical';

  /** Message */
  message: string;
}

export interface RulesEvaluationResult {
  /** Whether any rule matched */
  matched: boolean;

  /** All matching rules */
  matches: RuleMatch[];

  /** Final action (most restrictive) */
  finalAction: RuleAction;

  /** Rules that were evaluated */
  rulesEvaluated: number;

  /** Evaluation time in ms */
  evaluationTimeMs: number;
}

// ============================================================================
// Rules Engine
// ============================================================================

export class RulesEngine {
  private rules: Rule[] = [];

  constructor(rules?: Rule[]) {
    if (rules) {
      this.rules = this.sortRules(rules);
    }
  }

  /**
   * Add a rule
   */
  addRule(rule: Rule): void {
    this.rules.push(rule);
    this.rules = this.sortRules(this.rules);
  }

  /**
   * Remove a rule
   */
  removeRule(ruleId: string): boolean {
    const index = this.rules.findIndex((r) => r.id === ruleId);
    if (index !== -1) {
      this.rules.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Update a rule
   */
  updateRule(rule: Rule): boolean {
    const index = this.rules.findIndex((r) => r.id === rule.id);
    if (index !== -1) {
      this.rules[index] = rule;
      this.rules = this.sortRules(this.rules);
      return true;
    }
    return false;
  }

  /**
   * Get all rules
   */
  getRules(): Rule[] {
    return [...this.rules];
  }

  /**
   * Sort rules by priority
   */
  private sortRules(rules: Rule[]): Rule[] {
    return [...rules].sort((a, b) => a.priority - b.priority);
  }

  /**
   * Evaluate rules against context
   */
  evaluate(context: RuleEvaluationContext): RulesEvaluationResult {
    const startTime = performance.now();
    const matches: RuleMatch[] = [];

    for (const rule of this.rules) {
      if (!rule.enabled) continue;

      if (this.matchesRule(rule, context)) {
        matches.push({
          rule,
          action: rule.action,
          severity: rule.severity || 'medium',
          message: rule.message || `Rule "${rule.name}" matched`,
        });

        if (rule.stopOnMatch) {
          break;
        }
      }
    }

    // Determine final action (most restrictive)
    const actionOrder: Record<RuleAction, number> = {
      allow: 0,
      alert: 1,
      approve: 2,
      block: 3,
    };

    let finalAction: RuleAction = 'allow';
    for (const match of matches) {
      if (actionOrder[match.action] > actionOrder[finalAction]) {
        finalAction = match.action;
      }
    }

    return {
      matched: matches.length > 0,
      matches,
      finalAction,
      rulesEvaluated: this.rules.filter((r) => r.enabled).length,
      evaluationTimeMs: performance.now() - startTime,
    };
  }

  /**
   * Check if a rule matches the context
   */
  private matchesRule(rule: Rule, context: RuleEvaluationContext): boolean {
    // All conditions must match (AND logic)
    for (const condition of rule.conditions) {
      if (!this.matchesCondition(condition, context)) {
        return false;
      }
    }
    return true;
  }

  /**
   * Check if a condition matches the context
   */
  private matchesCondition(condition: RuleCondition, context: RuleEvaluationContext): boolean {
    const fieldValue = this.getFieldValue(condition.field, context);
    if (fieldValue === undefined) {
      return false;
    }

    const { operator, value, ignoreCase } = condition;

    // Handle string comparison
    const normalizedFieldValue = ignoreCase && typeof fieldValue === 'string'
      ? fieldValue.toLowerCase()
      : fieldValue;
    const normalizedValue = ignoreCase && typeof value === 'string'
      ? value.toLowerCase()
      : value;

    switch (operator) {
      case 'equals':
        return normalizedFieldValue === normalizedValue;

      case 'contains':
        if (typeof normalizedFieldValue === 'string' && typeof normalizedValue === 'string') {
          return normalizedFieldValue.includes(normalizedValue);
        }
        return false;

      case 'matches':
        if (typeof fieldValue === 'string' && typeof value === 'string') {
          try {
            const regex = new RegExp(value, ignoreCase ? 'i' : '');
            return regex.test(fieldValue);
          } catch {
            return false;
          }
        }
        return false;

      case 'starts_with':
        if (typeof normalizedFieldValue === 'string' && typeof normalizedValue === 'string') {
          return normalizedFieldValue.startsWith(normalizedValue);
        }
        return false;

      case 'ends_with':
        if (typeof normalizedFieldValue === 'string' && typeof normalizedValue === 'string') {
          return normalizedFieldValue.endsWith(normalizedValue);
        }
        return false;

      case 'in':
        if (Array.isArray(value)) {
          return value.some((v) => {
            const normalizedV = ignoreCase && typeof v === 'string' ? v.toLowerCase() : v;
            return normalizedFieldValue === normalizedV;
          });
        }
        return false;

      case 'not_in':
        if (Array.isArray(value)) {
          return !value.some((v) => {
            const normalizedV = ignoreCase && typeof v === 'string' ? v.toLowerCase() : v;
            return normalizedFieldValue === normalizedV;
          });
        }
        return false;

      case 'gt':
        if (typeof fieldValue === 'number' && typeof value === 'number') {
          return fieldValue > value;
        }
        return false;

      case 'lt':
        if (typeof fieldValue === 'number' && typeof value === 'number') {
          return fieldValue < value;
        }
        return false;

      case 'gte':
        if (typeof fieldValue === 'number' && typeof value === 'number') {
          return fieldValue >= value;
        }
        return false;

      case 'lte':
        if (typeof fieldValue === 'number' && typeof value === 'number') {
          return fieldValue <= value;
        }
        return false;

      default:
        return false;
    }
  }

  /**
   * Get field value from context
   */
  private getFieldValue(field: string, context: RuleEvaluationContext): unknown {
    // Direct fields
    switch (field) {
      case 'tool_name':
        return context.toolName;
      case 'server_name':
        return context.serverName;
      case 'action':
        return context.effect.action;
      case 'scope':
        return context.effect.scope;
      case 'risk':
        return context.effect.risk;
      case 'category':
        return context.effect.category;
      case 'target':
        return context.effect.target;
      case 'confidence':
        return context.effect.confidence;
    }

    // Parameter fields (param.*)
    if (field.startsWith('param.')) {
      const paramName = field.substring(6);
      return this.getNestedValue(context.parameters, paramName);
    }

    // Effect fields (effect.*)
    if (field.startsWith('effect.')) {
      const effectField = field.substring(7);
      return (context.effect as unknown as Record<string, unknown>)[effectField];
    }

    return undefined;
  }

  /**
   * Get nested value from object using dot notation
   */
  private getNestedValue(obj: Record<string, unknown>, path: string): unknown {
    const parts = path.split('.');
    let current: unknown = obj;

    for (const part of parts) {
      if (current === null || current === undefined) {
        return undefined;
      }
      if (typeof current === 'object') {
        current = (current as Record<string, unknown>)[part];
      } else {
        return undefined;
      }
    }

    return current;
  }

  /**
   * Validate a rule
   */
  validateRule(rule: Rule): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!rule.id) {
      errors.push('Rule must have an id');
    }

    if (!rule.name) {
      errors.push('Rule must have a name');
    }

    if (!rule.conditions || rule.conditions.length === 0) {
      errors.push('Rule must have at least one condition');
    }

    if (!rule.action) {
      errors.push('Rule must have an action');
    }

    const validActions = ['allow', 'block', 'alert', 'approve'];
    if (!validActions.includes(rule.action)) {
      errors.push(`Invalid action: ${rule.action}`);
    }

    for (const condition of rule.conditions || []) {
      if (!condition.field) {
        errors.push('Condition must have a field');
      }
      if (!condition.operator) {
        errors.push('Condition must have an operator');
      }
      if (condition.value === undefined) {
        errors.push('Condition must have a value');
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}

// ============================================================================
// Rule Parser
// ============================================================================

/**
 * Parse rules from YAML-like configuration
 */
export function parseRules(config: unknown): Rule[] {
  const rules: Rule[] = [];

  if (!config || typeof config !== 'object') {
    return rules;
  }

  const rulesConfig = (config as Record<string, unknown>).rules;
  if (!Array.isArray(rulesConfig)) {
    return rules;
  }

  for (const ruleConfig of rulesConfig) {
    if (!ruleConfig || typeof ruleConfig !== 'object') continue;

    const r = ruleConfig as Record<string, unknown>;
    const conditions: RuleCondition[] = [];

    if (Array.isArray(r.conditions)) {
      for (const c of r.conditions) {
        if (c && typeof c === 'object') {
          const cond = c as Record<string, unknown>;
          conditions.push({
            field: String(cond.field || ''),
            operator: String(cond.operator || 'equals') as RuleCondition['operator'],
            value: cond.value as string | number | string[],
            ignoreCase: Boolean(cond.ignore_case || cond.ignoreCase),
          });
        }
      }
    }

    rules.push({
      id: String(r.id || `rule_${rules.length + 1}`),
      name: String(r.name || 'Unnamed Rule'),
      description: r.description ? String(r.description) : undefined,
      enabled: r.enabled !== false,
      priority: Number(r.priority) || 100,
      conditions,
      action: String(r.action || 'alert') as RuleAction,
      severity: r.severity as Rule['severity'],
      message: r.message ? String(r.message) : undefined,
      stopOnMatch: Boolean(r.stop_on_match || r.stopOnMatch),
    });
  }

  return rules;
}

// ============================================================================
// Singleton Instance
// ============================================================================

let _rulesEngine: RulesEngine | null = null;

export function getRulesEngine(): RulesEngine {
  if (!_rulesEngine) {
    _rulesEngine = new RulesEngine();
  }
  return _rulesEngine;
}

export function configureRulesEngine(rules: Rule[]): void {
  _rulesEngine = new RulesEngine(rules);
}
