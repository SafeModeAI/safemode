/**
 * Hook Types
 *
 * Type definitions for Safe Mode hook system.
 */

import type { ToolCallEffect } from '../cet/types.js';

// ============================================================================
// Hook Names
// ============================================================================

export type HookName =
  | 'pre-tool-call'
  | 'post-tool-call'
  | 'schema-load'
  | 'session-start'
  | 'session-end'
  | 'on-error'
  | 'approval-request';

export const HOOK_NAMES: HookName[] = [
  'pre-tool-call',
  'post-tool-call',
  'schema-load',
  'session-start',
  'session-end',
  'on-error',
  'approval-request',
];

// ============================================================================
// Hook Context Types
// ============================================================================

export interface BaseHookContext {
  sessionId: string;
  timestamp: number;
}

export interface PreToolCallContext extends BaseHookContext {
  toolName: string;
  serverName: string;
  parameters: Record<string, unknown>;
  effect: ToolCallEffect;
}

export interface PostToolCallContext extends BaseHookContext {
  toolName: string;
  serverName: string;
  parameters: Record<string, unknown>;
  result: unknown;
  latencyMs: number;
}

export interface SchemaLoadContext extends BaseHookContext {
  serverName: string;
  tools: ToolSchema[];
}

export interface ToolSchema {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface SessionStartContext extends BaseHookContext {
  serverName: string;
}

export interface SessionEndContext extends BaseHookContext {
  stats: SessionStats;
}

export interface SessionStats {
  toolCalls: number;
  blocks: number;
  alerts: number;
  totalLatencyMs: number;
}

export interface OnErrorContext extends BaseHookContext {
  error: {
    message: string;
    stack?: string;
    code?: string;
  };
  context: {
    toolName?: string;
    serverName?: string;
    phase: 'pre-call' | 'execution' | 'post-call' | 'schema' | 'unknown';
  };
}

export interface ApprovalRequestContext extends BaseHookContext {
  toolName: string;
  serverName: string;
  effect: ToolCallEffect;
  reason: string;
  engineName?: string;
}

export type HookContext =
  | PreToolCallContext
  | PostToolCallContext
  | SchemaLoadContext
  | SessionStartContext
  | SessionEndContext
  | OnErrorContext
  | ApprovalRequestContext;

// ============================================================================
// Hook Result Types
// ============================================================================

export interface HookResult {
  /** Whether to continue with the operation */
  continue: boolean;

  /** Modified data (parameters, result, or tools) */
  modified?: unknown;

  /** Message to display/log */
  message?: string;

  /** Whether the request is approved (for approval-request hook) */
  approved?: boolean;
}

export interface HookExecutionResult {
  /** Hook that was executed */
  hookName: HookName;

  /** Whether execution succeeded */
  success: boolean;

  /** Result from the hook */
  result?: HookResult;

  /** Error if execution failed */
  error?: string;

  /** Execution time in ms */
  latencyMs: number;
}

// ============================================================================
// IDE Types
// ============================================================================

export type IDE = 'cursor' | 'claude-code' | 'vscode' | 'windsurf';

export interface IDEInfo {
  name: string;
  ide: IDE;
  hooksPath: string;
  configPath: string;
  installed: boolean;
}

// ============================================================================
// Hook Status Types
// ============================================================================

export interface HookStatus {
  /** Whether hooks are installed */
  installed: boolean;

  /** Path to hooks directory */
  path: string;

  /** Individual hook statuses */
  hooks: HookFileStatus[];

  /** IDE this status is for */
  ide: IDE;
}

export interface HookFileStatus {
  /** Hook name */
  name: HookName;

  /** Whether file exists */
  exists: boolean;

  /** Whether file is executable */
  executable: boolean;

  /** Full path to file */
  path: string;
}

// ============================================================================
// Hook Configuration
// ============================================================================

export interface HookConfig {
  /** Whether hooks are enabled */
  enabled: boolean;

  /** Timeout for hook execution in ms */
  timeoutMs: number;

  /** Whether to fail open (continue) or closed (abort) on hook error */
  failBehavior: 'open' | 'closed';

  /** Custom hooks directory (overrides default) */
  customDir?: string;
}

export const DEFAULT_HOOK_CONFIG: HookConfig = {
  enabled: true,
  timeoutMs: 10000, // 10 seconds max
  failBehavior: 'open', // Don't block on hook errors
  customDir: undefined,
};
