/**
 * Bridge Types
 *
 * Type definitions for Safe Mode cloud bridge to TrustScope API.
 */

// ============================================================================
// Connection Types
// ============================================================================

export interface BridgeConfig {
  /** TrustScope API base URL */
  apiUrl: string;

  /** API key (smdev_ prefix for Safe Mode devices) */
  apiKey: string;

  /** Organization ID */
  orgId?: string;

  /** Enable WebSocket for real-time sync */
  useWebSocket: boolean;

  /** Sync interval in ms (for HTTP polling) */
  syncIntervalMs: number;

  /** Heartbeat interval in ms */
  heartbeatIntervalMs: number;

  /** Event batch size */
  batchSize: number;

  /** Max retry attempts */
  maxRetries: number;

  /** Retry delay in ms */
  retryDelayMs: number;

  /** Connection timeout in ms */
  timeoutMs: number;
}

export const DEFAULT_BRIDGE_CONFIG: BridgeConfig = {
  apiUrl: 'https://api.trustscope.ai',
  apiKey: '',
  orgId: undefined,
  useWebSocket: false,
  syncIntervalMs: 30000, // 30 seconds
  heartbeatIntervalMs: 60000, // 1 minute
  batchSize: 100,
  maxRetries: 3,
  retryDelayMs: 1000,
  timeoutMs: 10000,
};

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';

export interface ConnectionStatus {
  state: ConnectionState;
  lastConnected?: number;
  lastError?: string;
  retryCount: number;
  latencyMs?: number;
}

// ============================================================================
// Authentication Types
// ============================================================================

export interface DeviceCredentials {
  /** Device ID (unique identifier for this Safe Mode instance) */
  deviceId: string;

  /** API key with smdev_ prefix */
  apiKey: string;

  /** Device name (hostname or user-provided) */
  deviceName: string;

  /** Device type */
  deviceType: 'cli' | 'mcp_proxy' | 'ide_plugin';

  /** Associated organization */
  orgId?: string;

  /** Associated user */
  userId?: string;
}

export interface TokenExchangeRequest {
  /** Device credentials */
  credentials: DeviceCredentials;

  /** Requested scopes */
  scopes: string[];

  /** Token TTL in seconds */
  ttlSeconds?: number;
}

export interface TokenExchangeResponse {
  /** Access token */
  accessToken: string;

  /** Token type (always 'Bearer') */
  tokenType: 'Bearer';

  /** Expiry timestamp */
  expiresAt: number;

  /** Refresh token (optional) */
  refreshToken?: string;

  /** Granted scopes */
  scopes: string[];

  /** Organization ID */
  orgId: string;

  /** Tier access level */
  tier: 'monitor' | 'protect' | 'enforce' | 'govern';
}

// ============================================================================
// Event Sync Types
// ============================================================================

export interface SyncEvent {
  /** Event ID (UUID) */
  id: string;

  /** Session ID */
  sessionId: string;

  /** Event type */
  type: 'tool_call' | 'detection' | 'block' | 'approval' | 'error' | 'session_start' | 'session_end';

  /** Timestamp (ISO 8601) */
  timestamp: string;

  /** Tool name (if applicable) */
  toolName?: string;

  /** Server name */
  serverName?: string;

  /** Risk level */
  riskLevel?: 'low' | 'medium' | 'high' | 'critical';

  /** Action taken */
  action?: 'allow' | 'alert' | 'block' | 'approve' | 'reject';

  /** Engine results */
  engineResults?: EngineResultSummary[];

  /** Effect classification */
  effect?: EffectSummary;

  /** Additional details */
  details?: Record<string, unknown>;

  /** Latency in ms */
  latencyMs?: number;
}

export interface EngineResultSummary {
  engineId: number;
  engineName: string;
  detected: boolean;
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical';
  action: 'allow' | 'alert' | 'block';
}

export interface EffectSummary {
  action: string;
  target: string;
  scope: string;
  risk: string;
  category: string;
}

export interface SyncBatch {
  /** Batch ID */
  batchId: string;

  /** Device ID */
  deviceId: string;

  /** Events in this batch */
  events: SyncEvent[];

  /** Batch timestamp */
  timestamp: string;

  /** Sequence number */
  sequence: number;
}

export interface SyncResponse {
  /** Success status */
  success: boolean;

  /** Batch ID acknowledged */
  batchId: string;

  /** Events processed */
  processed: number;

  /** Events failed */
  failed: number;

  /** Error details (if any) */
  errors?: SyncError[];

  /** Server timestamp */
  serverTimestamp: string;
}

export interface SyncError {
  eventId: string;
  error: string;
  retryable: boolean;
}

// ============================================================================
// Policy Types
// ============================================================================

export interface CloudPolicy {
  /** Policy ID */
  id: string;

  /** Policy name */
  name: string;

  /** Policy version */
  version: number;

  /** Policy type */
  type: string;

  /** Policy configuration */
  config: Record<string, unknown>;

  /** Knob overrides from this policy */
  knobOverrides?: KnobOverride[];

  /** Enabled status */
  enabled: boolean;

  /** Created timestamp */
  createdAt: string;

  /** Updated timestamp */
  updatedAt: string;
}

export interface KnobOverride {
  /** Knob category */
  category: string;

  /** Knob name */
  knob: string;

  /** Override value */
  value: 'allow' | 'approve' | 'block';

  /** Reason for override */
  reason?: string;
}

export interface PolicyPullResponse {
  /** Policies */
  policies: CloudPolicy[];

  /** Policy version (for caching) */
  version: number;

  /** Last updated timestamp */
  lastUpdated: string;

  /** Hash of policy set */
  hash: string;
}

// ============================================================================
// Heartbeat Types
// ============================================================================

export interface HeartbeatRequest {
  /** Device ID */
  deviceId: string;

  /** Device name */
  deviceName: string;

  /** Current status */
  status: 'healthy' | 'degraded' | 'error';

  /** Active sessions count */
  activeSessions: number;

  /** Events pending sync */
  pendingEvents: number;

  /** Current policy version */
  policyVersion: number;

  /** Safe Mode version */
  version: string;

  /** System info */
  system: SystemInfo;

  /** Stats since last heartbeat */
  stats: HeartbeatStats;
}

export interface SystemInfo {
  /** Platform (darwin, linux, win32) */
  platform: string;

  /** Node.js version */
  nodeVersion: string;

  /** Hostname */
  hostname: string;

  /** Uptime in seconds */
  uptimeSeconds: number;

  /** Memory usage in MB */
  memoryMb: number;
}

export interface HeartbeatStats {
  /** Tool calls since last heartbeat */
  toolCalls: number;

  /** Detections since last heartbeat */
  detections: number;

  /** Blocks since last heartbeat */
  blocks: number;

  /** Errors since last heartbeat */
  errors: number;

  /** Average latency in ms */
  avgLatencyMs: number;
}

export interface HeartbeatResponse {
  /** Acknowledged */
  acknowledged: boolean;

  /** Server timestamp */
  serverTimestamp: string;

  /** Commands to execute */
  commands?: DeviceCommand[];

  /** Policy update available */
  policyUpdateAvailable?: boolean;

  /** New policy version */
  newPolicyVersion?: number;
}

export interface DeviceCommand {
  /** Command ID */
  id: string;

  /** Command type */
  type: 'reload_policy' | 'flush_events' | 'restart' | 'update' | 'disconnect';

  /** Command payload */
  payload?: Record<string, unknown>;

  /** Execute before timestamp */
  executeBy?: string;
}

// ============================================================================
// Approval Types
// ============================================================================

export interface ApprovalRequest {
  /** Request ID */
  id: string;

  /** Session ID */
  sessionId: string;

  /** Tool name */
  toolName: string;

  /** Server name */
  serverName: string;

  /** Parameters (redacted) */
  parameters: Record<string, unknown>;

  /** Effect classification */
  effect: EffectSummary;

  /** Reason approval is needed */
  reason: string;

  /** Engine that triggered approval */
  triggeredBy: string;

  /** Request timestamp */
  timestamp: string;

  /** Expiry timestamp */
  expiresAt: string;
}

export interface ApprovalDecision {
  /** Request ID */
  requestId: string;

  /** Decision */
  decision: 'approve' | 'reject';

  /** User who made decision */
  userId: string;

  /** Decision timestamp */
  timestamp: string;

  /** Optional message */
  message?: string;
}

// ============================================================================
// WebSocket Types
// ============================================================================

export interface WebSocketMessage {
  /** Message type */
  type: 'event' | 'policy_update' | 'command' | 'approval_request' | 'approval_decision' | 'heartbeat' | 'ack';

  /** Message payload */
  payload: unknown;

  /** Message ID */
  messageId: string;

  /** Timestamp */
  timestamp: string;
}

export interface WebSocketConfig {
  /** WebSocket URL */
  url: string;

  /** Reconnect on disconnect */
  reconnect: boolean;

  /** Reconnect delay in ms */
  reconnectDelayMs: number;

  /** Max reconnect attempts */
  maxReconnectAttempts: number;

  /** Ping interval in ms */
  pingIntervalMs: number;
}
