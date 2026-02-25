/**
 * Engine 8: Throughput Drop
 *
 * Detects sudden drops in throughput that may indicate problems.
 * >50% drop = alert
 */

import type { DetectionEngine, EngineResult, EngineContext } from './base.js';

export class ThroughputDropEngine implements DetectionEngine {
  readonly id = 8;
  readonly name = 'throughput_drop';
  readonly description = 'Detects sudden throughput drops';

  private alertThreshold = 0.5; // 50% drop
  private windowMs = 30000; // 30 second windows

  async evaluate(context: EngineContext): Promise<EngineResult> {
    const { session } = context;

    const timestamps = session.call_timestamps;
    const now = Date.now();

    // Need at least 2 windows worth of data
    if (timestamps.length < 10) {
      return {
        engine_id: this.id,
        engine_name: this.name,
        detected: false,
        severity: 'info',
        confidence: 0.5,
        action: 'allow',
        details: { reason: 'Insufficient throughput data' },
        latency_ms: 0,
      };
    }

    // Calculate throughput for recent window vs previous window
    const recentCalls = timestamps.filter((t) => t >= now - this.windowMs).length;
    const previousCalls = timestamps.filter(
      (t) => t >= now - this.windowMs * 2 && t < now - this.windowMs
    ).length;

    if (previousCalls === 0) {
      return {
        engine_id: this.id,
        engine_name: this.name,
        detected: false,
        severity: 'info',
        confidence: 0.5,
        action: 'allow',
        details: { reason: 'No previous window data' },
        latency_ms: 0,
      };
    }

    const dropRate = 1 - recentCalls / previousCalls;

    if (dropRate >= this.alertThreshold) {
      return {
        engine_id: this.id,
        engine_name: this.name,
        detected: true,
        severity: 'medium',
        confidence: 0.75,
        action: 'alert',
        details: {
          reason: `Throughput dropped ${Math.round(dropRate * 100)}% (${previousCalls} → ${recentCalls} calls)`,
          drop_rate: dropRate,
          recent_calls: recentCalls,
          previous_calls: previousCalls,
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
        recent_calls: recentCalls,
        previous_calls: previousCalls,
      },
      latency_ms: 0,
    };
  }
}
