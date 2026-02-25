/**
 * Engine 15: Action Label Mismatch
 *
 * Detects when a tool's declared action doesn't match CET classification.
 * Example: Tool says "read_file" but CET detects "execute" action.
 */

import type { DetectionEngine, EngineResult, EngineContext } from './base.js';

// ============================================================================
// Action Categories
// ============================================================================

const READ_ACTIONS = new Set(['read', 'get', 'fetch', 'list', 'search', 'find', 'query', 'view', 'show']);
const WRITE_ACTIONS = new Set(['write', 'create', 'update', 'modify', 'set', 'put', 'post', 'add', 'insert', 'save']);
const DELETE_ACTIONS = new Set(['delete', 'remove', 'drop', 'destroy', 'clear', 'purge', 'truncate']);
const EXECUTE_ACTIONS = new Set(['execute', 'run', 'exec', 'shell', 'command', 'eval', 'invoke']);

// ============================================================================
// Action Label Mismatch Engine
// ============================================================================

export class ActionLabelMismatch implements DetectionEngine {
  readonly id = 15;
  readonly name = 'action_label_mismatch';
  readonly description = 'Detects mismatches between declared and actual tool actions';

  async evaluate(context: EngineContext): Promise<EngineResult> {
    const { tool_name, effect } = context;

    // Extract declared action from tool name
    const declaredAction = this.extractDeclaredAction(tool_name);

    if (!declaredAction) {
      // Can't determine declared action, skip check
      return this.allowResult();
    }

    // Compare declared vs actual (CET classification)
    const actualAction = effect.action;
    const mismatch = this.checkMismatch(declaredAction, actualAction);

    if (mismatch) {
      // Severity depends on the nature of the mismatch
      const severity = this.getMismatchSeverity(declaredAction, actualAction);

      return {
        engine_id: this.id,
        engine_name: this.name,
        detected: true,
        severity,
        confidence: 0.8,
        action: severity === 'critical' ? 'block' : 'alert',
        details: {
          reason: `Action mismatch: Tool "${tool_name}" declares "${declaredAction}" but classified as "${actualAction}"`,
          declared_action: declaredAction,
          actual_action: actualAction,
          tool_name,
        },
        latency_ms: 0,
      };
    }

    return this.allowResult();
  }

  /**
   * Extract the declared action from tool name
   */
  private extractDeclaredAction(
    toolName: string
  ): 'read' | 'write' | 'delete' | 'execute' | null {
    const nameLower = toolName.toLowerCase();

    // Check for read indicators
    for (const action of READ_ACTIONS) {
      if (nameLower.includes(action)) {
        return 'read';
      }
    }

    // Check for write indicators
    for (const action of WRITE_ACTIONS) {
      if (nameLower.includes(action)) {
        return 'write';
      }
    }

    // Check for delete indicators
    for (const action of DELETE_ACTIONS) {
      if (nameLower.includes(action)) {
        return 'delete';
      }
    }

    // Check for execute indicators
    for (const action of EXECUTE_ACTIONS) {
      if (nameLower.includes(action)) {
        return 'execute';
      }
    }

    return null;
  }

  /**
   * Check if there's a mismatch between declared and actual actions
   */
  private checkMismatch(
    declared: 'read' | 'write' | 'delete' | 'execute',
    actual: string
  ): boolean {
    // Map actual actions to categories
    const actualCategory = this.categorizeAction(actual);

    // Certain mismatches are more concerning
    if (declared === 'read' && (actualCategory === 'write' || actualCategory === 'execute')) {
      return true;
    }

    if (declared !== actualCategory && actualCategory !== 'unknown') {
      return true;
    }

    return false;
  }

  /**
   * Categorize an action string
   */
  private categorizeAction(action: string): 'read' | 'write' | 'delete' | 'execute' | 'unknown' {
    const actionLower = action.toLowerCase();

    if (READ_ACTIONS.has(actionLower) || actionLower === 'list' || actionLower === 'search') {
      return 'read';
    }

    if (WRITE_ACTIONS.has(actionLower) || actionLower === 'create') {
      return 'write';
    }

    if (DELETE_ACTIONS.has(actionLower)) {
      return 'delete';
    }

    if (EXECUTE_ACTIONS.has(actionLower) || actionLower === 'transfer') {
      return 'execute';
    }

    return 'unknown';
  }

  /**
   * Determine severity based on the mismatch
   */
  private getMismatchSeverity(
    declared: string,
    actual: string
  ): 'medium' | 'high' | 'critical' {
    // Read declared but execute actual = critical
    if (declared === 'read' && actual === 'execute') {
      return 'critical';
    }

    // Read declared but delete actual = high
    if (declared === 'read' && actual === 'delete') {
      return 'high';
    }

    // Read declared but write actual = high
    if (declared === 'read' && actual === 'write') {
      return 'high';
    }

    // Other mismatches = medium
    return 'medium';
  }

  private allowResult(): EngineResult {
    return {
      engine_id: this.id,
      engine_name: this.name,
      detected: false,
      severity: 'info',
      confidence: 1.0,
      action: 'allow',
      details: {},
      latency_ms: 0,
    };
  }
}
