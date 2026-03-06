/**
 * Detection Engine Base Types
 *
 * All 15 CPU/regex engines implement this interface.
 */

import type { ToolCallEffect, RiskLevel } from '../cet/types.js';

// ============================================================================
// Engine Result Types
// ============================================================================

export type EngineSeverity = 'info' | 'low' | 'medium' | 'high' | 'critical';
export type EngineAction = 'allow' | 'alert' | 'block';

/**
 * Result from a single engine evaluation
 */
export interface EngineResult {
  /** Numeric engine identifier (1-15) */
  engine_id: number;

  /** Human-readable engine name */
  engine_name: string;

  /** Whether the engine detected something noteworthy */
  detected: boolean;

  /** Severity of the detection */
  severity: EngineSeverity;

  /** Confidence in the detection (0.0 - 1.0) */
  confidence: number;

  /** Recommended action */
  action: EngineAction;

  /** Additional details about the detection */
  details: Record<string, unknown>;

  /** Time taken by this engine in milliseconds */
  latency_ms: number;
}

// ============================================================================
// Engine Context
// ============================================================================

/**
 * Session state tracked across tool calls
 */
export interface SessionState {
  /** Unique session identifier */
  session_id: string;

  /** When the session started */
  started_at: Date;

  /** Total tool calls in this session */
  tool_call_count: number;

  /** Total cost accumulated this session (USD) */
  session_cost_usd: number;

  /** Recent tool call signatures for loop/oscillation detection */
  recent_signatures: ToolCallSignature[];

  /** Error count per server */
  error_counts: Map<string, number>;

  /** Call counts per server */
  call_counts: Map<string, number>;

  /** Latency history per server (for P95 calculation) */
  latency_history: Map<string, number[]>;

  /** Timestamp of each tool call (for rate limiting) */
  call_timestamps: number[];

  /** Per-minute call counts for throughput tracking */
  calls_per_minute: number[];
}

/**
 * Signature of a tool call for deduplication
 */
export interface ToolCallSignature {
  tool_name: string;
  params_hash: string;
  timestamp: number;
}

/**
 * Engine-specific configuration from presets/knobs
 */
export interface EngineConfig {
  /** Whether this engine is enabled */
  enabled: boolean;

  /** Engine-specific thresholds and settings */
  thresholds: Record<string, number>;

  /** Preset name for context */
  preset: string;
}

/**
 * Context passed to each engine
 */
export interface EngineContext {
  /** Name of the tool being called */
  tool_name: string;

  /** Name of the MCP server */
  server_name: string;

  /** Parameters passed to the tool */
  parameters: Record<string, unknown>;

  /** Response from the tool (for output scanning) */
  response?: unknown;

  /** CET classification of the tool call (ToolCallEffect) */
  effect: ToolCallEffect;

  /** Current session state */
  session: SessionState;

  /** Engine configuration (optional) */
  config?: EngineConfig;
}

// ============================================================================
// Engine Interface
// ============================================================================

/**
 * Base interface for all detection engines
 */
export interface DetectionEngine {
  /** Numeric engine ID (1-15) */
  readonly id: number;

  /** Human-readable name */
  readonly name: string;

  /** Brief description of what this engine detects */
  readonly description: string;

  /**
   * Evaluate the tool call and return a result
   *
   * @param context - The context for this evaluation
   * @returns Engine result with detection status and recommended action
   */
  evaluate(context: EngineContext): Promise<EngineResult>;
}

// ============================================================================
// Engine Registry Types
// ============================================================================

/**
 * Combined result from running all selected engines
 */
export interface EngineEvaluationResult {
  /** Results from all engines that were run */
  results: EngineResult[];

  /** The most restrictive action from all engines */
  final_action: EngineAction;

  /** Highest severity detected */
  highest_severity: EngineSeverity;

  /** Total number of engines run */
  engines_run: number;

  /** Number of engines that detected something */
  engines_triggered: number;

  /** Total latency in milliseconds */
  total_latency_ms: number;

  /** Whether any engine blocked the action */
  blocked: boolean;

  /** If blocked, the engine that blocked it */
  blocked_by?: string;

  /** If blocked, the reason */
  block_reason?: string;
}

// ============================================================================
// Engine Selection
// ============================================================================

/**
 * Engines to run based on risk level
 *
 * Low: Counters only (1-8) - ~2ms
 * Medium: Counters + Content + Rules (1-10, 13-15) - ~5ms
 * High: Full battery including ML (1-15) - ~20ms
 * Critical: Full battery + sequential - ~25ms
 */
export const ENGINE_ROUTING: Record<RiskLevel, number[]> = {
  low: [1, 2, 3, 4, 5, 6, 7, 8],
  medium: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  high: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  critical: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
};

/**
 * Compare actions (returns positive if a is more restrictive than b)
 */
export function compareAction(a: EngineAction, b: EngineAction): number {
  const order: Record<EngineAction, number> = {
    allow: 0,
    alert: 1,
    block: 2,
  };
  return order[a] - order[b];
}

/**
 * Get the most restrictive action
 */
export function maxAction(a: EngineAction, b: EngineAction): EngineAction {
  return compareAction(a, b) >= 0 ? a : b;
}

/**
 * Compare severities (returns positive if a > b)
 */
export function compareSeverity(a: EngineSeverity, b: EngineSeverity): number {
  const order: Record<EngineSeverity, number> = {
    info: 0,
    low: 1,
    medium: 2,
    high: 3,
    critical: 4,
  };
  return order[a] - order[b];
}

/**
 * Get the higher severity
 */
export function maxSeverity(a: EngineSeverity, b: EngineSeverity): EngineSeverity {
  return compareSeverity(a, b) >= 0 ? a : b;
}

/**
 * Create a default "no detection" result
 */
export function createNoDetectionResult(
  engine_id: number,
  engine_name: string,
  latency_ms: number
): EngineResult {
  return {
    engine_id,
    engine_name,
    detected: false,
    severity: 'info',
    confidence: 1.0,
    action: 'allow',
    details: {},
    latency_ms,
  };
}

/**
 * Create a detection result
 */
export function createDetectionResult(
  engine_id: number,
  engine_name: string,
  severity: EngineSeverity,
  action: EngineAction,
  confidence: number,
  details: Record<string, unknown>,
  latency_ms: number
): EngineResult {
  return {
    engine_id,
    engine_name,
    detected: true,
    severity,
    confidence,
    action,
    details,
    latency_ms,
  };
}
