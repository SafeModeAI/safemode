/**
 * Engine 3: Velocity Limiter
 *
 * Rate limits tool calls to prevent runaway behavior.
 * 60/min = alert
 * 120/min = block
 */

import type { DetectionEngine, EngineResult, EngineContext } from './base.js';

export class VelocityLimiterEngine implements DetectionEngine {
  readonly id = 3;
  readonly name = 'velocity_limiter';
  readonly description = 'Rate limits tool calls per minute';

  private alertThreshold = 60;
  private blockThreshold = 120;
  private windowMs = 60000; // 1 minute

  async evaluate(context: EngineContext): Promise<EngineResult> {
    const { session } = context;

    // Count calls in the last minute
    const now = Date.now();
    const windowStart = now - this.windowMs;
    const callsInWindow = session.call_timestamps.filter((t) => t >= windowStart).length;

    // Add 1 for current call
    const totalCalls = callsInWindow + 1;

    if (totalCalls >= this.blockThreshold) {
      return {
        engine_id: this.id,
        engine_name: this.name,
        detected: true,
        severity: 'high',
        confidence: 0.95,
        action: 'block',
        details: {
          reason: `Rate limit exceeded: ${totalCalls} calls/min (limit: ${this.blockThreshold})`,
          calls_per_minute: totalCalls,
          threshold: this.blockThreshold,
        },
        latency_ms: 0,
      };
    }

    if (totalCalls >= this.alertThreshold) {
      return {
        engine_id: this.id,
        engine_name: this.name,
        detected: true,
        severity: 'medium',
        confidence: 0.9,
        action: 'alert',
        details: {
          reason: `High call rate: ${totalCalls} calls/min (warning at ${this.alertThreshold})`,
          calls_per_minute: totalCalls,
          threshold: this.alertThreshold,
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
      details: { calls_per_minute: totalCalls },
      latency_ms: 0,
    };
  }
}
