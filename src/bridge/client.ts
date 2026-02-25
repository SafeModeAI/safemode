/**
 * Bridge Client
 *
 * Main client for connecting Safe Mode to TrustScope cloud.
 */

import type {
  BridgeConfig,
  ConnectionStatus,
  CloudPolicy,
  SyncEvent,
  ApprovalRequest,
  ApprovalDecision,
} from './types.js';
import { DEFAULT_BRIDGE_CONFIG } from './types.js';

import {
  getDeviceCredentials,
  createDeviceCredentials,
  validateApiKey,
  verifyConnection,
  clearCredentials,
  isDeviceRegistered,
} from './auth.js';

import {
  queueEvent,
  queueToolCallEvent,
  queueDetectionEvent,
  queueBlockEvent,
  queueSessionStartEvent,
  queueSessionEndEvent,
  syncAll,
  flushEvents,
  startBackgroundSync,
  stopBackgroundSync,
  getSyncStats,
  getPendingCount,
} from './sync.js';

import {
  pullPolicies,
  getCachedPolicies,
  getMatchingPolicies,
  shouldBlock,
  requiresApproval,
  extractKnobOverrides,
  mergeKnobOverrides,
  startPolicyRefresh,
  stopPolicyRefresh,
  forcePolicyRefresh,
  getPolicyVersion,
} from './policy.js';

import {
  sendHeartbeat,
  startHeartbeat,
  stopHeartbeat,
  getConnectionStatus,
  getBridgeHealth,
  recordToolCall,
  recordDetection,
  recordBlock,
  recordError,
  setActiveSessionCount,
} from './heartbeat.js';

// ============================================================================
// Bridge Client
// ============================================================================

export class BridgeClient {
  private config: BridgeConfig;
  private started: boolean = false;

  constructor(config: Partial<BridgeConfig> = {}) {
    this.config = { ...DEFAULT_BRIDGE_CONFIG, ...config };
  }

  // ==========================================================================
  // Connection Management
  // ==========================================================================

  /**
   * Connect to TrustScope cloud
   */
  async connect(apiKey?: string): Promise<{
    success: boolean;
    orgId?: string;
    tier?: string;
    error?: string;
  }> {
    // If API key provided, register device
    if (apiKey) {
      const validation = validateApiKey(apiKey);
      if (!validation.valid) {
        return { success: false, error: validation.error };
      }

      createDeviceCredentials(apiKey);
      this.config.apiKey = apiKey;
    }

    // Verify connection
    const result = await verifyConnection(this.config);

    if (result.connected) {
      // Start background services
      this.start();
    }

    return {
      success: result.connected,
      orgId: result.orgId,
      tier: result.tier,
      error: result.error,
    };
  }

  /**
   * Disconnect from TrustScope cloud
   */
  disconnect(): void {
    this.stop();
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return getConnectionStatus().state === 'connected';
  }

  /**
   * Get connection status
   */
  getStatus(): ConnectionStatus {
    return getConnectionStatus();
  }

  /**
   * Check if device is registered
   */
  isRegistered(): boolean {
    return isDeviceRegistered();
  }

  // ==========================================================================
  // Background Services
  // ==========================================================================

  /**
   * Start all background services
   */
  start(): void {
    if (this.started) return;

    startBackgroundSync(this.config);
    startPolicyRefresh(this.config);
    startHeartbeat(this.config);

    this.started = true;
  }

  /**
   * Stop all background services
   */
  stop(): void {
    stopBackgroundSync();
    stopPolicyRefresh();
    stopHeartbeat();

    this.started = false;
  }

  /**
   * Check if background services are running
   */
  isRunning(): boolean {
    return this.started;
  }

  // ==========================================================================
  // Event Sync
  // ==========================================================================

  /**
   * Queue an event for sync
   */
  queueEvent(event: Omit<SyncEvent, 'id' | 'timestamp'>): void {
    queueEvent(event);
  }

  /**
   * Queue a tool call event
   */
  trackToolCall(
    sessionId: string,
    toolName: string,
    serverName: string,
    outcome: 'allow' | 'alert' | 'block',
    details?: Record<string, unknown>
  ): void {
    queueToolCallEvent(sessionId, toolName, serverName, outcome, details);
    recordToolCall();

    if (outcome === 'block') {
      recordBlock();
    }
  }

  /**
   * Queue a detection event
   */
  trackDetection(
    sessionId: string,
    toolName: string,
    serverName: string,
    engineResults: SyncEvent['engineResults'],
    riskLevel: SyncEvent['riskLevel']
  ): void {
    queueDetectionEvent(sessionId, toolName, serverName, engineResults, riskLevel);
    recordDetection();
  }

  /**
   * Queue a block event
   */
  trackBlock(
    sessionId: string,
    toolName: string,
    serverName: string,
    reason: string,
    triggeredBy: string
  ): void {
    queueBlockEvent(sessionId, toolName, serverName, reason, triggeredBy);
    recordBlock();
  }

  /**
   * Track session start
   */
  trackSessionStart(sessionId: string, serverName: string): void {
    queueSessionStartEvent(sessionId, serverName);
  }

  /**
   * Track session end
   */
  trackSessionEnd(
    sessionId: string,
    stats: {
      toolCalls: number;
      detections: number;
      blocks: number;
      durationMs: number;
    }
  ): void {
    queueSessionEndEvent(sessionId, stats);
  }

  /**
   * Track error
   */
  trackError(): void {
    recordError();
  }

  /**
   * Sync all pending events now
   */
  async syncNow(): Promise<{ synced: number; failed: number }> {
    const result = await syncAll(this.config);
    return { synced: result.synced, failed: result.failed };
  }

  /**
   * Flush all events immediately
   */
  async flush(): Promise<{ count: number }> {
    const result = await flushEvents(this.config);
    return { count: result.count };
  }

  /**
   * Get sync statistics
   */
  getSyncStats(): {
    pending: number;
    synced: number;
    failed: number;
    lastSync: number;
  } {
    return getSyncStats();
  }

  /**
   * Get pending event count
   */
  getPendingCount(): number {
    return getPendingCount();
  }

  // ==========================================================================
  // Policy Management
  // ==========================================================================

  /**
   * Pull latest policies
   */
  async pullPolicies(): Promise<CloudPolicy[]> {
    const response = await pullPolicies(this.config);
    return response.policies;
  }

  /**
   * Get cached policies
   */
  getCachedPolicies(): CloudPolicy[] {
    return getCachedPolicies();
  }

  /**
   * Force policy refresh
   */
  async refreshPolicies(): Promise<CloudPolicy[]> {
    return forcePolicyRefresh(this.config);
  }

  /**
   * Get current policy version
   */
  getPolicyVersion(): number {
    return getPolicyVersion();
  }

  /**
   * Check if action should be blocked by policy
   */
  shouldBlock(
    toolName: string,
    serverName: string,
    action?: string
  ): { blocked: boolean; reason?: string } {
    const result = shouldBlock(toolName, serverName, action);
    return { blocked: result.blocked, reason: result.reason };
  }

  /**
   * Check if action requires approval
   */
  requiresApproval(
    toolName: string,
    serverName: string,
    action?: string
  ): { required: boolean; approvers?: string[] } {
    const result = requiresApproval(toolName, serverName, action);
    return { required: result.required, approvers: result.approvers };
  }

  /**
   * Get policies matching a tool call
   */
  getMatchingPolicies(
    toolName: string,
    serverName: string,
    action?: string
  ): CloudPolicy[] {
    return getMatchingPolicies(toolName, serverName, action);
  }

  /**
   * Extract knob overrides from policies
   */
  getKnobOverrides(): {
    category: string;
    knob: string;
    value: 'allow' | 'approve' | 'block';
    reason?: string;
  }[] {
    return extractKnobOverrides();
  }

  /**
   * Merge knob overrides with base config
   */
  mergeKnobs(
    base: Record<string, Record<string, 'allow' | 'approve' | 'block'>>
  ): Record<string, Record<string, 'allow' | 'approve' | 'block'>> {
    const overrides = extractKnobOverrides();
    return mergeKnobOverrides(base, overrides);
  }

  // ==========================================================================
  // Health & Heartbeat
  // ==========================================================================

  /**
   * Send heartbeat now
   */
  async heartbeat(): Promise<void> {
    await sendHeartbeat(this.config);
  }

  /**
   * Get bridge health
   */
  getHealth(): {
    healthy: boolean;
    state: string;
    lastHeartbeat?: number;
    pendingEvents: number;
    errorCount: number;
    avgLatencyMs: number;
  } {
    return getBridgeHealth();
  }

  /**
   * Update active session count
   */
  setActiveSessionCount(count: number): void {
    setActiveSessionCount(count);
  }

  // ==========================================================================
  // Approvals (For Future Use)
  // ==========================================================================

  /**
   * Request approval from cloud
   */
  async requestApproval(request: ApprovalRequest): Promise<string> {
    const credentials = getDeviceCredentials();
    if (!credentials) {
      throw new Error('Not connected');
    }

    const response = await fetch(`${this.config.apiUrl}/v1/approvals`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Device-ID': credentials.deviceId,
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });

    if (!response.ok) {
      throw new Error(`Approval request failed: ${response.status}`);
    }

    const data = (await response.json()) as { requestId: string };
    return data.requestId;
  }

  /**
   * Check approval status
   */
  async checkApproval(requestId: string): Promise<ApprovalDecision | null> {
    const credentials = getDeviceCredentials();
    if (!credentials) {
      throw new Error('Not connected');
    }

    const response = await fetch(
      `${this.config.apiUrl}/v1/approvals/${requestId}`,
      {
        method: 'GET',
        headers: {
          'X-Device-ID': credentials.deviceId,
        },
        signal: AbortSignal.timeout(this.config.timeoutMs),
      }
    );

    if (response.status === 404) {
      return null; // Pending
    }

    if (!response.ok) {
      throw new Error(`Approval check failed: ${response.status}`);
    }

    return (await response.json()) as ApprovalDecision;
  }

  // ==========================================================================
  // Cleanup
  // ==========================================================================

  /**
   * Clear all stored credentials and caches
   */
  clearAll(): void {
    this.stop();
    clearCredentials();
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let _bridgeClient: BridgeClient | null = null;

/**
 * Get or create bridge client singleton
 */
export function getBridgeClient(config?: Partial<BridgeConfig>): BridgeClient {
  if (!_bridgeClient) {
    _bridgeClient = new BridgeClient(config);
  }
  return _bridgeClient;
}

/**
 * Reset bridge client (for testing)
 */
export function resetBridgeClient(): void {
  if (_bridgeClient) {
    _bridgeClient.stop();
    _bridgeClient = null;
  }
}
