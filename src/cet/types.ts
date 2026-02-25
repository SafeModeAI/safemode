/**
 * CET (Constrained Execution Tools) Types
 *
 * Every tool call is decomposed into a ToolCallEffect that describes
 * what the action does, where it targets, and its risk level.
 */

// ============================================================================
// Core Effect Types
// ============================================================================

/**
 * Actions a tool can perform
 */
export type ToolAction =
  | 'read'
  | 'write'
  | 'create'
  | 'delete'
  | 'execute'
  | 'transfer'
  | 'search'
  | 'list';

/**
 * Scope of the action's target
 */
export type ToolScope =
  | 'project'
  | 'user_home'
  | 'system'
  | 'network'
  | 'financial';

/**
 * Risk level based on action + scope
 */
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

/**
 * Tool categories for knob mapping
 */
export type ToolCategory =
  | 'filesystem'
  | 'terminal'
  | 'git'
  | 'network'
  | 'database'
  | 'financial'
  | 'api'
  | 'communication'
  | 'cloud'
  | 'container'
  | 'package'
  | 'scheduling'
  | 'authentication'
  | 'deployment'
  | 'monitoring'
  | 'data'
  | 'browser'
  | 'physical'
  | 'unknown';

/**
 * The decomposed effect of a tool call
 */
export interface ToolCallEffect {
  /** The type of action being performed */
  action: ToolAction;

  /** The target of the action (file path, URL, table name, etc.) */
  target: string;

  /** The scope of the target */
  scope: ToolScope;

  /** Risk level based on action and scope */
  risk: RiskLevel;

  /** Category for knob mapping */
  category: ToolCategory;

  /** Confidence in the classification (0.0 - 1.0) */
  confidence: number;

  /** Source of classification: 'registry' (L1) or 'inference' (L2) */
  source: 'registry' | 'inference';
}

// ============================================================================
// Known Tool Registry Types
// ============================================================================

/**
 * Entry in the known tool registry
 */
export interface KnownToolEntry {
  /** Fixed action type for this tool */
  action?: ToolAction;

  /** Parameter path to determine action from (e.g., "parameters.query") */
  action_from?: string;

  /** Fixed scope for this tool */
  scope?: ToolScope;

  /** Parameter path to determine scope from (e.g., "parameters.path") */
  scope_from?: string;

  /** Tool category */
  category: ToolCategory;

  /** Fixed risk level */
  risk?: RiskLevel;

  /** Whether to compute risk from scope */
  risk_from_scope?: boolean;

  /** Whether to compute risk from action */
  risk_from_action?: boolean;
}

/**
 * Known tool registry structure: "server:tool" → entry
 */
export type KnownToolRegistry = Record<string, KnownToolEntry>;

// ============================================================================
// Risk Matrix
// ============================================================================

/**
 * Risk matrix: action × scope → risk level
 *
 * | Action   | project | user_home | system   | network | financial |
 * |----------|---------|-----------|----------|---------|-----------|
 * | read     | low     | low       | medium   | low     | low       |
 * | write    | low     | medium    | high     | medium  | high      |
 * | create   | low     | medium    | high     | medium  | high      |
 * | delete   | medium  | high      | critical | high    | critical  |
 * | execute  | medium  | high      | critical | high    | critical  |
 * | transfer | low     | low       | low      | medium  | critical  |
 * | search   | low     | low       | low      | low     | low       |
 * | list     | low     | low       | low      | low     | low       |
 */
export const RISK_MATRIX: Record<ToolAction, Record<ToolScope, RiskLevel>> = {
  read: {
    project: 'low',
    user_home: 'low',
    system: 'medium',
    network: 'low',
    financial: 'low',
  },
  write: {
    project: 'low',
    user_home: 'medium',
    system: 'high',
    network: 'medium',
    financial: 'high',
  },
  create: {
    project: 'low',
    user_home: 'medium',
    system: 'high',
    network: 'medium',
    financial: 'high',
  },
  delete: {
    project: 'medium',
    user_home: 'high',
    system: 'critical',
    network: 'high',
    financial: 'critical',
  },
  execute: {
    project: 'medium',
    user_home: 'high',
    system: 'critical',
    network: 'high',
    financial: 'critical',
  },
  transfer: {
    project: 'low',
    user_home: 'low',
    system: 'low',
    network: 'medium',
    financial: 'critical',
  },
  search: {
    project: 'low',
    user_home: 'low',
    system: 'low',
    network: 'low',
    financial: 'low',
  },
  list: {
    project: 'low',
    user_home: 'low',
    system: 'low',
    network: 'low',
    financial: 'low',
  },
};

/**
 * Get risk level from action and scope using the risk matrix
 */
export function getRiskFromMatrix(action: ToolAction, scope: ToolScope): RiskLevel {
  return RISK_MATRIX[action][scope];
}

/**
 * Compare risk levels (returns positive if a > b)
 */
export function compareRisk(a: RiskLevel, b: RiskLevel): number {
  const order: Record<RiskLevel, number> = {
    low: 0,
    medium: 1,
    high: 2,
    critical: 3,
  };
  return order[a] - order[b];
}

/**
 * Get the higher risk level
 */
export function maxRisk(a: RiskLevel, b: RiskLevel): RiskLevel {
  return compareRisk(a, b) >= 0 ? a : b;
}
