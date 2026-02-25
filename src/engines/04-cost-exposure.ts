/**
 * Engine 4: Cost Exposure
 *
 * Tracks session cost and alerts/blocks when approaching budget.
 * 80% = alert
 * 100% = handled by Budget Cap engine
 */

import type { DetectionEngine, EngineResult, EngineContext } from './base.js';

export class CostExposureEngine implements DetectionEngine {
  readonly id = 4;
  readonly name = 'cost_exposure';
  readonly description = 'Tracks session cost against budget';

  private alertPercentage = 0.8;
  private budgetCost: number;

  constructor(
    maxSessionCost: number,
    _alertAt: number
  ) {
    this.budgetCost = maxSessionCost;
  }

  async evaluate(context: EngineContext): Promise<EngineResult> {
    const { session } = context;

    const currentCost = session.session_cost_usd;
    const percentage = currentCost / this.budgetCost;

    if (percentage >= this.alertPercentage) {
      return {
        engine_id: this.id,
        engine_name: this.name,
        detected: true,
        severity: 'medium',
        confidence: 1.0,
        action: 'alert',
        details: {
          reason: `Budget ${Math.round(percentage * 100)}% consumed ($${currentCost.toFixed(2)} of $${this.budgetCost})`,
          current_cost: currentCost,
          max_cost: this.budgetCost,
          percentage: percentage,
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
        max_cost: this.budgetCost,
        percentage: percentage,
      },
      latency_ms: 0,
    };
  }
}
