/**
 * Engine 1: Loop Killer
 *
 * Detects repeated identical tool calls that indicate a stuck loop.
 * >5 identical calls in 60s = alert
 * >10 identical calls in 60s = block
 */

import type { DetectionEngine, EngineResult, EngineContext } from './base.js';

export class LoopKillerEngine implements DetectionEngine {
  readonly id = 1;
  readonly name = 'loop_killer';
  readonly description = 'Detects repeated identical tool calls';

  private alertThreshold = 5;
  private blockThreshold = 10;
  private windowMs = 60000; // 60 seconds

  async evaluate(context: EngineContext): Promise<EngineResult> {
    const { session, tool_name, parameters } = context;

    // Get recent signatures for this tool
    const now = Date.now();
    const windowStart = now - this.windowMs;

    // Create signature for current call
    const currentSig = this.createSignature(tool_name, parameters);

    // Count matching signatures in window
    let matchCount = 0;
    for (const sig of session.recent_signatures) {
      if (sig.timestamp >= windowStart && sig.tool_name === tool_name) {
        // Check if params match (using hash from signature)
        const sigHash = this.hashParams(parameters);
        if (sig.params_hash === sigHash) {
          matchCount++;
        }
      }
    }

    // Determine action
    if (matchCount >= this.blockThreshold) {
      return {
        engine_id: this.id,
        engine_name: this.name,
        detected: true,
        severity: 'high',
        confidence: 0.95,
        action: 'block',
        details: {
          reason: `Loop detected: ${matchCount} identical calls in ${this.windowMs / 1000}s`,
          match_count: matchCount,
          threshold: this.blockThreshold,
          signature: currentSig,
        },
        latency_ms: 0,
      };
    }

    if (matchCount >= this.alertThreshold) {
      return {
        engine_id: this.id,
        engine_name: this.name,
        detected: true,
        severity: 'medium',
        confidence: 0.8,
        action: 'alert',
        details: {
          reason: `Potential loop: ${matchCount} identical calls in ${this.windowMs / 1000}s`,
          match_count: matchCount,
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
      details: { match_count: matchCount },
      latency_ms: 0,
    };
  }

  private createSignature(toolName: string, params: Record<string, unknown>): string {
    return `${toolName}:${this.hashParams(params)}`;
  }

  private hashParams(params: Record<string, unknown>): string {
    // Simple hash for comparison (actual hash done in interceptor)
    return JSON.stringify(params).slice(0, 32);
  }
}
