/**
 * Engine 6: Latency Spike
 *
 * Detects unusual latency that may indicate problems.
 * >3x P95 = alert
 */

import type { DetectionEngine, EngineResult, EngineContext } from './base.js';

export class LatencySpikeEngine implements DetectionEngine {
  readonly id = 6;
  readonly name = 'latency_spike';
  readonly description = 'Detects unusual latency spikes';

  private spikeMultiplier = 3.0;
  private minSamples = 5;

  async evaluate(context: EngineContext): Promise<EngineResult> {
    const { session, server_name } = context;

    // Get latency history for this server
    const history = session.latency_history.get(server_name) || [];

    if (history.length < this.minSamples) {
      return {
        engine_id: this.id,
        engine_name: this.name,
        detected: false,
        severity: 'info',
        confidence: 0.5,
        action: 'allow',
        details: { reason: 'Insufficient latency data' },
        latency_ms: 0,
      };
    }

    // Calculate P95
    const sorted = [...history].sort((a, b) => a - b);
    const p95Index = Math.floor(sorted.length * 0.95);
    const p95 = sorted[p95Index] ?? sorted[sorted.length - 1] ?? 1;

    // Get last latency (most recent)
    const lastLatency = history[history.length - 1] ?? 0;
    const spike = lastLatency / p95;

    if (spike >= this.spikeMultiplier) {
      return {
        engine_id: this.id,
        engine_name: this.name,
        detected: true,
        severity: 'medium',
        confidence: 0.8,
        action: 'alert',
        details: {
          reason: `Latency spike: ${lastLatency}ms (${spike.toFixed(1)}x P95 of ${p95}ms)`,
          last_latency_ms: lastLatency,
          p95_ms: p95,
          spike_multiplier: spike,
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
        last_latency_ms: lastLatency,
        p95_ms: p95,
      },
      latency_ms: 0,
    };
  }
}
