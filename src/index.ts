/**
 * Safe Mode — MCP Governance Proxy
 *
 * Safe Mode sits between AI clients and MCP servers, providing:
 * - Schema rewriting (ATSP) to constrain tool capabilities
 * - Tool call classification (CET) for risk assessment
 * - Detection engines for anomaly and threat detection
 * - Knob-based policy enforcement
 * - Event logging and audit trail
 *
 * @license Apache-2.0
 */

// Re-export core types
export * from './proxy/protocol.js';
export * from './cet/types.js';
export * from './engines/base.js';
export * from './knobs/categories.js';
export * from './config/index.js';

// Re-export main components
export { MCPWrapper } from './proxy/wrapper.js';
export { MessageInterceptor } from './proxy/interceptor.js';
export { ATSPEngine } from './atsp/index.js';
export { CETClassifier } from './cet/index.js';
export { EngineRegistry } from './engines/index.js';
export { KnobGate } from './knobs/index.js';
export { SchemaQuarantine } from './quarantine/schema.js';
export { OutputQuarantine } from './quarantine/output.js';
export { TOFUManager } from './tofu/index.js';
export { EventStore, getEventStore, closeEventStore } from './store/index.js';
export { ConfigLoader } from './config/index.js';
export { NotificationManager, getNotificationManager } from './notifications/index.js';
export { FirstRunScanner } from './scanner/index.js';

// Sprint 1B exports
export { getModelManager, getInference, isOnnxAvailable } from './ml/index.js';
export { PromptInjectionEngine } from './engines/11-prompt-injection.js';
export { JailbreakEngine } from './engines/12-jailbreak.js';
export { SnapshotStore, getSnapshotStore } from './timemachine/index.js';
export { ApprovalManager, getApprovalManager, configureApprovalManager } from './approvals/index.js';
export { TelegramApprovalProvider } from './approvals/telegram.js';
export { DiscordApprovalProvider } from './approvals/discord.js';
export { RulesEngine, getRulesEngine, parseRules } from './rules/index.js';

// Sprint 1C exports
export {
  HookExecutor,
  getHookExecutor,
  HookInstaller,
  getHookInstaller,
  type HookName,
  type HookContext,
  type HookResult,
  type HookConfig,
  type HookStatus,
  type IDE,
  type IDEInfo,
  HOOK_NAMES,
  runGovernancePipeline,
  type Surface,
  type HookInput,
} from './hooks/index.js';

// Sprint 2 Bridge exports
export {
  BridgeClient,
  getBridgeClient,
  resetBridgeClient,
  type BridgeConfig,
  type ConnectionStatus,
  type SyncEvent,
  type CloudPolicy,
  type HeartbeatStats,
  DEFAULT_BRIDGE_CONFIG,
  isDeviceRegistered,
  getConnectionStatus,
  getBridgeHealth,
} from './bridge/index.js';
