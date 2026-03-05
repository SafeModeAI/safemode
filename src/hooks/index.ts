/**
 * Hooks Module
 *
 * Safe Mode hook system for IDE integration.
 */

// Types
export type {
  HookName,
  HookContext,
  HookResult,
  HookExecutionResult,
  HookConfig,
  HookStatus,
  HookFileStatus,
  IDE,
  IDEInfo,
  BaseHookContext,
  PreToolCallContext,
  PostToolCallContext,
  SchemaLoadContext,
  SessionStartContext,
  SessionEndContext,
  OnErrorContext,
  ApprovalRequestContext,
  SessionStats,
  ToolSchema,
} from './types.js';

export { HOOK_NAMES, DEFAULT_HOOK_CONFIG } from './types.js';

// Executor
export { HookExecutor, getHookExecutor, resetHookExecutor } from './executor.js';

// Installer
export { HookInstaller, getHookInstaller } from './installer.js';

// Hook Runner (governance pipeline for hook-based surfaces)
export { runGovernancePipeline } from './hook-runner.js';
export type { Surface, HookInput } from './hook-runner.js';
