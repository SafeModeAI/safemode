/**
 * Engine Registry
 *
 * Manages and runs detection engines based on risk level.
 * Implements risk-based routing for optimal latency.
 */

import type {
  DetectionEngine,
  EngineResult,
  EngineContext,
  SessionState,
  EngineEvaluationResult,
  EngineAction,
} from './base.js';
import type { ToolCallEffect } from '../cet/types.js';
import { ENGINE_ROUTING, maxAction } from './base.js';

// Import all engines
import { LoopKillerEngine } from './01-loop-killer.js';
import { OscillationEngine } from './02-oscillation.js';
import { VelocityLimiterEngine } from './03-velocity-limiter.js';
import { CostExposureEngine } from './04-cost-exposure.js';
import { ActionGrowthEngine } from './05-action-growth.js';
import { LatencySpikeEngine } from './06-latency-spike.js';
import { ErrorRateEngine } from './07-error-rate.js';
import { ThroughputDropEngine } from './08-throughput-drop.js';
import { PIIScanner } from './09-pii-scanner.js';
import { SecretsScanner } from './10-secrets-scanner.js';
import { PromptInjectionEngine } from './11-prompt-injection.js';
import { JailbreakEngine } from './12-jailbreak.js';
import { CommandFirewall } from './13-command-firewall.js';
import { BudgetCap } from './14-budget-cap.js';
import { ActionLabelMismatch } from './15-action-label-mismatch.js';

// ============================================================================
// Types
// ============================================================================

export interface EngineRegistryConfig {
  /** Maximum budget for session */
  maxSessionCost: number;

  /** Alert threshold for budget */
  alertAt: number;

  /** Fail behavior for high/critical risk */
  failBehavior: 'open' | 'closed';
}

// ============================================================================
// Engine Registry
// ============================================================================

export class EngineRegistry {
  private engines: Map<number, DetectionEngine> = new Map();
  private config: EngineRegistryConfig;

  constructor(config: EngineRegistryConfig) {
    this.config = config;
    this.initializeEngines();
  }

  /**
   * Initialize all engines
   */
  private initializeEngines(): void {
    // Engines 1-8: Counters and Timers
    this.engines.set(1, new LoopKillerEngine());
    this.engines.set(2, new OscillationEngine());
    this.engines.set(3, new VelocityLimiterEngine());
    this.engines.set(4, new CostExposureEngine(this.config.maxSessionCost, this.config.alertAt));
    this.engines.set(5, new ActionGrowthEngine());
    this.engines.set(6, new LatencySpikeEngine());
    this.engines.set(7, new ErrorRateEngine());
    this.engines.set(8, new ThroughputDropEngine());

    // Engines 9-10: Content Scanners
    this.engines.set(9, new PIIScanner());
    this.engines.set(10, new SecretsScanner());

    // Engines 11-12: ML-based Scanners (with regex fallback)
    this.engines.set(11, new PromptInjectionEngine());
    this.engines.set(12, new JailbreakEngine());

    // Engines 13-15: Rules and Patterns
    this.engines.set(13, new CommandFirewall());
    this.engines.set(14, new BudgetCap(this.config.maxSessionCost));
    this.engines.set(15, new ActionLabelMismatch());
  }

  /**
   * Evaluate a tool call through the engine pipeline
   */
  async evaluate(
    toolName: string,
    serverName: string,
    params: Record<string, unknown>,
    effect: ToolCallEffect,
    session: SessionState
  ): Promise<EngineEvaluationResult> {
    const startTime = performance.now();

    // Determine which engines to run based on risk
    const engineIds = ENGINE_ROUTING[effect.risk] || ENGINE_ROUTING.low;

    // Build context
    const context: EngineContext = {
      tool_name: toolName,
      server_name: serverName,
      parameters: params,
      effect,
      session,
    };

    // Run engines (parallel for low/medium, sequential for high/critical)
    let results: EngineResult[];
    if (effect.risk === 'critical') {
      results = await this.runSequential(engineIds, context);
    } else {
      results = await this.runParallel(engineIds, context);
    }

    // Aggregate results
    const triggered = results.filter((r) => r.detected);
    const blocked = triggered.find((r) => r.action === 'block');

    // Determine highest severity
    const severityOrder: Record<string, number> = {
      info: 0,
      low: 1,
      medium: 2,
      high: 3,
      critical: 4,
    };

    let highestSeverity: EngineResult['severity'] = 'info';
    for (const result of triggered) {
      const resultOrder = severityOrder[result.severity] ?? 0;
      const highestOrder = severityOrder[highestSeverity] ?? 0;
      if (resultOrder > highestOrder) {
        highestSeverity = result.severity;
      }
    }

    const totalLatency = performance.now() - startTime;

    // Determine final action (most restrictive)
    let finalAction: EngineAction = 'allow';
    for (const result of results) {
      finalAction = maxAction(finalAction, result.action);
    }

    return {
      blocked: !!blocked,
      blocked_by: blocked?.engine_name,
      block_reason: blocked?.details?.reason as string | undefined,
      engines_run: results.length,
      engines_triggered: triggered.length,
      highest_severity: highestSeverity,
      final_action: finalAction,
      results,
      total_latency_ms: Math.round(totalLatency),
    };
  }

  /**
   * Run engines in parallel
   */
  private async runParallel(
    engineIds: number[],
    context: EngineContext
  ): Promise<EngineResult[]> {
    const promises = engineIds
      .map((id) => this.engines.get(id))
      .filter((engine): engine is DetectionEngine => engine !== undefined)
      .map((engine) => this.runEngine(engine, context));

    const settled = await Promise.allSettled(promises);

    return settled
      .filter((r): r is PromiseFulfilledResult<EngineResult> => r.status === 'fulfilled')
      .map((r) => r.value);
  }

  /**
   * Run engines sequentially (stops on block for critical risk)
   */
  private async runSequential(
    engineIds: number[],
    context: EngineContext
  ): Promise<EngineResult[]> {
    const results: EngineResult[] = [];

    for (const id of engineIds) {
      const engine = this.engines.get(id);
      if (!engine) continue;

      try {
        const result = await this.runEngine(engine, context);
        results.push(result);

        // Stop early on block for critical risk
        if (result.action === 'block') {
          break;
        }
      } catch (error) {
        // Handle engine error based on fail behavior
        results.push(this.createErrorResult(engine, error as Error, context));
      }
    }

    return results;
  }

  /**
   * Run a single engine with error handling
   */
  private async runEngine(
    engine: DetectionEngine,
    context: EngineContext
  ): Promise<EngineResult> {
    const startTime = performance.now();

    try {
      const result = await engine.evaluate(context);
      result.latency_ms = Math.round(performance.now() - startTime);
      return result;
    } catch (error) {
      const latency = Math.round(performance.now() - startTime);
      return this.createErrorResult(engine, error as Error, context, latency);
    }
  }

  /**
   * Create error result based on fail behavior
   */
  private createErrorResult(
    engine: DetectionEngine,
    error: Error,
    context: EngineContext,
    latency?: number
  ): EngineResult {
    // For high/critical risk, fail closed (block)
    // For low/medium risk, fail open (allow with alert)
    const shouldBlock =
      this.config.failBehavior === 'closed' &&
      (context.effect.risk === 'high' || context.effect.risk === 'critical');

    return {
      engine_id: engine.id,
      engine_name: engine.name,
      detected: shouldBlock,
      severity: shouldBlock ? 'high' : 'medium',
      confidence: 0,
      action: shouldBlock ? 'block' : 'alert',
      details: {
        error: error.message,
        fail_mode: shouldBlock ? 'closed' : 'open',
      },
      latency_ms: latency || 0,
    };
  }

  /**
   * Get engine by ID
   */
  getEngine(id: number): DetectionEngine | undefined {
    return this.engines.get(id);
  }

  /**
   * Get all engine IDs
   */
  getEngineIds(): number[] {
    return Array.from(this.engines.keys());
  }

  /**
   * Update budget configuration
   */
  updateBudget(maxSessionCost: number, alertAt: number): void {
    this.config.maxSessionCost = maxSessionCost;
    this.config.alertAt = alertAt;

    // Re-initialize budget-related engines
    this.engines.set(4, new CostExposureEngine(maxSessionCost, alertAt));
    this.engines.set(14, new BudgetCap(maxSessionCost));
  }
}
