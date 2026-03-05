/**
 * Engine 14: Budget Cap
 *
 * Hard block when session cost reaches budget limit.
 * session_cost >= budget → block ALL calls
 */

import type { DetectionEngine, EngineResult, EngineContext } from './base.js';

export class BudgetCap implements DetectionEngine {
  readonly id = 14;
  readonly name = 'budget_cap';
  readonly description = 'Hard block at budget limit';

  constructor(private maxSessionCost: number) {}

  async evaluate(context: EngineContext): Promise<EngineResult> {
    const { session } = context;

    const currentCost = session.session_cost_usd;

    if (currentCost >= this.maxSessionCost) {
      return {
        engine_id: this.id,
        engine_name: this.name,
        detected: true,
        severity: 'critical',
        confidence: 1.0,
        action: 'block',
        details: {
          reason: `Estimated budget exceeded: ~$${currentCost.toFixed(2)} >= $${this.maxSessionCost} limit`,
          current_cost: currentCost,
          max_cost: this.maxSessionCost,
        },
        latency_ms: 0,
      };
    }

    return {
      engine_id: this.id,
      engine_name: this.name,
      detected: false,
      severity: 'info',
      confidence: 1.0,
      action: 'allow',
      details: {
        current_cost: currentCost,
        max_cost: this.maxSessionCost,
        remaining: this.maxSessionCost - currentCost,
      },
      latency_ms: 0,
    };
  }

  /**
   * Update the budget limit
   */
  setBudget(maxCost: number): void {
    this.maxSessionCost = maxCost;
  }
}
