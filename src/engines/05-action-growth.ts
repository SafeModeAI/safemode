/**
 * Engine 5: Action Growth
 *
 * Detects accelerating call rates that may indicate runaway behavior.
 * Compares recent rate to historical average.
 */

import type { DetectionEngine, EngineResult, EngineContext } from './base.js';

export class ActionGrowthEngine implements DetectionEngine {
  readonly id = 5;
  readonly name = 'action_growth';
  readonly description = 'Detects accelerating call rates';

  private alertMultiplier = 2.0; // 2x normal rate
  private blockMultiplier = 4.0; // 4x normal rate
  private minSampleSize = 10;

  async evaluate(context: EngineContext): Promise<EngineResult> {
    const { session } = context;

    if (session.call_timestamps.length < this.minSampleSize) {
      return {
        engine_id: this.id,
        engine_name: this.name,
        detected: false,
        severity: 'info',
        confidence: 0.5,
        action: 'allow',
        details: { reason: 'Insufficient data for rate analysis' },
        latency_ms: 0,
      };
    }

    const timestamps = session.call_timestamps;
    const now = Date.now();

    // Calculate rate for last 30 seconds vs previous period
    const recentWindow = 30000;
    const recentCalls = timestamps.filter((t) => t >= now - recentWindow).length;
    const olderCalls = timestamps.filter(
      (t) => t >= now - recentWindow * 2 && t < now - recentWindow
    ).length;

    if (olderCalls === 0) {
      return {
        engine_id: this.id,
        engine_name: this.name,
        detected: false,
        severity: 'info',
        confidence: 0.5,
        action: 'allow',
        details: { reason: 'No historical data for comparison' },
        latency_ms: 0,
      };
    }

    const growthRate = recentCalls / olderCalls;

    if (growthRate >= this.blockMultiplier) {
      return {
        engine_id: this.id,
        engine_name: this.name,
        detected: true,
        severity: 'high',
        confidence: 0.85,
        action: 'alert', // Just alert, don't block on acceleration alone
        details: {
          reason: `Rapid acceleration: ${growthRate.toFixed(1)}x increase in call rate`,
          recent_calls: recentCalls,
          older_calls: olderCalls,
          growth_rate: growthRate,
        },
        latency_ms: 0,
      };
    }

    if (growthRate >= this.alertMultiplier) {
      return {
        engine_id: this.id,
        engine_name: this.name,
        detected: true,
        severity: 'medium',
        confidence: 0.75,
        action: 'alert',
        details: {
          reason: `Increasing call rate: ${growthRate.toFixed(1)}x normal`,
          recent_calls: recentCalls,
          older_calls: olderCalls,
          growth_rate: growthRate,
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
      details: { growth_rate: growthRate },
      latency_ms: 0,
    };
  }
}
