/**
 * Bridge Module
 *
 * Cloud bridge for connecting Safe Mode to TrustScope API.
 */

// Types
export type {
  BridgeConfig,
  ConnectionState,
  ConnectionStatus,
  DeviceCredentials,
  TokenExchangeRequest,
  TokenExchangeResponse,
  SyncEvent,
  SyncBatch,
  SyncResponse,
  SyncError,
  EngineResultSummary,
  EffectSummary,
  CloudPolicy,
  KnobOverride,
  PolicyPullResponse,
  HeartbeatRequest,
  HeartbeatResponse,
  HeartbeatStats,
  SystemInfo,
  DeviceCommand,
  ApprovalRequest,
  ApprovalDecision,
  WebSocketMessage,
  WebSocketConfig,
} from './types.js';

export { DEFAULT_BRIDGE_CONFIG } from './types.js';

// Auth
export {
  generateDeviceId,
  getDeviceCredentials,
  saveDeviceCredentials,
  createDeviceCredentials,
  validateApiKey,
  getCachedToken,
  cacheToken,
  clearTokenCache,
  exchangeToken,
  getAccessToken,
  refreshTokenIfNeeded,
  verifyConnection,
  clearCredentials,
  isDeviceRegistered,
} from './auth.js';

// Sync
export {
  queueEvent,
  getPendingCount,
  getSyncStats,
  syncAll,
  flushEvents,
  startBackgroundSync,
  stopBackgroundSync,
  isBackgroundSyncRunning,
  queueToolCallEvent,
  queueDetectionEvent,
  queueBlockEvent,
  queueSessionStartEvent,
  queueSessionEndEvent,
  clearPendingEvents,
} from './sync.js';

// Policy
export {
  pullPolicies,
  getPolicyVersion,
  getCachedPolicies,
  needsPolicyRefresh,
  extractKnobOverrides,
  mergeKnobOverrides,
  getMatchingPolicies,
  shouldBlock,
  requiresApproval,
  computePolicyHash,
  havePoliciesChanged,
  startPolicyRefresh,
  stopPolicyRefresh,
  isPolicyRefreshRunning,
  forcePolicyRefresh,
  clearPolicyCache,
} from './policy.js';

// Heartbeat
export {
  getConnectionStatus,
  setConnectionState,
  recordLatency,
  recordToolCall,
  recordDetection,
  recordBlock,
  recordError,
  setActiveSessionCount,
  getHeartbeatStats,
  sendHeartbeat,
  processCommands,
  startHeartbeat,
  stopHeartbeat,
  isHeartbeatRunning,
  forceHeartbeat,
  getBridgeHealth,
  needsReconnection,
  reconnect,
} from './heartbeat.js';

// Client
export { BridgeClient, getBridgeClient, resetBridgeClient } from './client.js';
