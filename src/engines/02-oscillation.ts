/**
 * Engine 2: Oscillation Detector
 *
 * Detects A→B→A→B oscillation patterns that indicate confusion.
 * 3+ oscillations = alert
 * 5+ oscillations = block
 */

import type { DetectionEngine, EngineResult, EngineContext } from './base.js';

export class OscillationEngine implements DetectionEngine {
  readonly id = 2;
  readonly name = 'oscillation';
  readonly description = 'Detects A→B→A→B oscillation patterns';

  private alertThreshold = 3;
  private blockThreshold = 5;

  async evaluate(context: EngineContext): Promise<EngineResult> {
    const { session, tool_name } = context;

    // Get recent tool names
    const recentTools = session.recent_signatures.slice(-20).map((s) => s.tool_name);

    // Detect oscillation pattern
    const oscillationCount = this.detectOscillation(recentTools, tool_name);

    if (oscillationCount >= this.blockThreshold) {
      return {
        engine_id: this.id,
        engine_name: this.name,
        detected: true,
        severity: 'high',
        confidence: 0.9,
        action: 'block',
        details: {
          reason: `Oscillation detected: ${oscillationCount} alternations`,
          oscillation_count: oscillationCount,
          pattern: this.getPattern(recentTools, tool_name),
        },
        latency_ms: 0,
      };
    }

    if (oscillationCount >= this.alertThreshold) {
      return {
        engine_id: this.id,
        engine_name: this.name,
        detected: true,
        severity: 'medium',
        confidence: 0.8,
        action: 'alert',
        details: {
          reason: `Potential oscillation: ${oscillationCount} alternations`,
          oscillation_count: oscillationCount,
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
      details: { oscillation_count: oscillationCount },
      latency_ms: 0,
    };
  }

  private detectOscillation(recentTools: string[], currentTool: string): number {
    if (recentTools.length < 3) return 0;

    // Add current tool
    const tools = [...recentTools, currentTool];

    // Look for A→B→A→B pattern
    let maxOscillation = 0;

    for (let i = tools.length - 2; i >= 1; i--) {
      const a = tools[i];
      const b = tools[i - 1];

      if (a === b) continue; // Same tool, not oscillation

      // Count how many times we see the A→B or B→A pattern
      let count = 0;
      let expectA = true;

      for (let j = i - 1; j >= 0; j--) {
        const expected = expectA ? a : b;
        if (tools[j] === expected) {
          count++;
          expectA = !expectA;
        } else {
          break;
        }
      }

      // Also check forward
      expectA = false;
      for (let j = i; j < tools.length; j++) {
        const expected = expectA ? a : b;
        if (tools[j] === expected) {
          count++;
          expectA = !expectA;
        } else {
          break;
        }
      }

      maxOscillation = Math.max(maxOscillation, Math.floor(count / 2));
    }

    return maxOscillation;
  }

  private getPattern(recentTools: string[], currentTool: string): string {
    const tools = [...recentTools.slice(-4), currentTool];
    return tools.join(' → ');
  }
}
