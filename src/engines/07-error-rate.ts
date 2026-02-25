/**
 * Engine 7: Error Rate
 *
 * Detects high error rates that may indicate problems.
 * >30% = alert
 * >50% = block
 */

import type { DetectionEngine, EngineResult, EngineContext } from './base.js';

export class ErrorRateEngine implements DetectionEngine {
  readonly id = 7;
  readonly name = 'error_rate';
  readonly description = 'Detects high error rates';

  private alertThreshold = 0.3; // 30%
  private blockThreshold = 0.5; // 50%
  private minCalls = 5;

  async evaluate(context: EngineContext): Promise<EngineResult> {
    const { session, server_name } = context;

    // Get call and error counts for this server
    const callCount = session.call_counts.get(server_name) || 0;
    const errorCount = session.error_counts.get(server_name) || 0;

    if (callCount < this.minCalls) {
      return {
        engine_id: this.id,
        engine_name: this.name,
        detected: false,
        severity: 'info',
        confidence: 0.5,
        action: 'allow',
        details: { reason: 'Insufficient call data' },
        latency_ms: 0,
      };
    }

    const errorRate = errorCount / callCount;

    if (errorRate >= this.blockThreshold) {
      return {
        engine_id: this.id,
        engine_name: this.name,
        detected: true,
        severity: 'high',
        confidence: 0.9,
        action: 'block',
        details: {
          reason: `Critical error rate: ${Math.round(errorRate * 100)}% (${errorCount}/${callCount} calls failed)`,
          error_rate: errorRate,
          error_count: errorCount,
          call_count: callCount,
        },
        latency_ms: 0,
      };
    }

    if (errorRate >= this.alertThreshold) {
      return {
        engine_id: this.id,
        engine_name: this.name,
        detected: true,
        severity: 'medium',
        confidence: 0.85,
        action: 'alert',
        details: {
          reason: `High error rate: ${Math.round(errorRate * 100)}% (${errorCount}/${callCount} calls failed)`,
          error_rate: errorRate,
          error_count: errorCount,
          call_count: callCount,
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
        error_rate: errorRate,
        error_count: errorCount,
        call_count: callCount,
      },
      latency_ms: 0,
    };
  }
}
