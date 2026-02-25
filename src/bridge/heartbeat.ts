/**
 * Heartbeat
 *
 * Connection health monitoring and device status reporting.
 */

import { hostname, platform, freemem, totalmem, uptime } from 'node:os';

import type {
  BridgeConfig,
  HeartbeatRequest,
  HeartbeatResponse,
  HeartbeatStats,
  SystemInfo,
  DeviceCommand,
  ConnectionStatus,
  ConnectionState,
} from './types.js';
import { getAccessToken, getDeviceCredentials } from './auth.js';
import { getPendingCount, flushEvents } from './sync.js';
import { getPolicyVersion, forcePolicyRefresh } from './policy.js';

// ============================================================================
// Constants
// ============================================================================

const VERSION = '1.0.0'; // Safe Mode version

// ============================================================================
// Connection State
// ============================================================================

let connectionStatus: ConnectionStatus = {
  state: 'disconnected',
  retryCount: 0,
};

let heartbeatStats: HeartbeatStats = {
  toolCalls: 0,
  detections: 0,
  blocks: 0,
  errors: 0,
  avgLatencyMs: 0,
};

let latencyHistory: number[] = [];
let activeSessionCount = 0;

/**
 * Get current connection status
 */
export function getConnectionStatus(): ConnectionStatus {
  return { ...connectionStatus };
}

/**
 * Update connection state
 */
export function setConnectionState(
  state: ConnectionState,
  error?: string
): void {
  connectionStatus.state = state;

  if (state === 'connected') {
    connectionStatus.lastConnected = Date.now();
    connectionStatus.retryCount = 0;
    connectionStatus.lastError = undefined;
  } else if (state === 'error') {
    connectionStatus.lastError = error;
    connectionStatus.retryCount++;
  } else if (state === 'reconnecting') {
    connectionStatus.retryCount++;
  }
}

/**
 * Update latency measurement
 */
export function recordLatency(latencyMs: number): void {
  latencyHistory.push(latencyMs);

  // Keep last 100 measurements
  if (latencyHistory.length > 100) {
    latencyHistory = latencyHistory.slice(-100);
  }

  // Update average
  heartbeatStats.avgLatencyMs = Math.round(
    latencyHistory.reduce((a, b) => a + b, 0) / latencyHistory.length
  );

  connectionStatus.latencyMs = latencyMs;
}

// ============================================================================
// Stats Tracking
// ============================================================================

/**
 * Record a tool call
 */
export function recordToolCall(): void {
  heartbeatStats.toolCalls++;
}

/**
 * Record a detection
 */
export function recordDetection(): void {
  heartbeatStats.detections++;
}

/**
 * Record a block
 */
export function recordBlock(): void {
  heartbeatStats.blocks++;
}

/**
 * Record an error
 */
export function recordError(): void {
  heartbeatStats.errors++;
}

/**
 * Update active session count
 */
export function setActiveSessionCount(count: number): void {
  activeSessionCount = count;
}

/**
 * Get current stats
 */
export function getHeartbeatStats(): HeartbeatStats {
  return { ...heartbeatStats };
}

/**
 * Reset stats (called after heartbeat)
 */
function resetStats(): void {
  heartbeatStats = {
    toolCalls: 0,
    detections: 0,
    blocks: 0,
    errors: 0,
    avgLatencyMs: heartbeatStats.avgLatencyMs, // Keep average
  };
}

// ============================================================================
// System Info
// ============================================================================

/**
 * Get system information
 */
function getSystemInfo(): SystemInfo {
  const usedMem = totalmem() - freemem();

  return {
    platform: platform(),
    nodeVersion: process.version,
    hostname: hostname(),
    uptimeSeconds: Math.floor(uptime()),
    memoryMb: Math.round(usedMem / 1024 / 1024),
  };
}

// ============================================================================
// Heartbeat
// ============================================================================

/**
 * Build heartbeat request
 */
function buildHeartbeatRequest(): HeartbeatRequest | null {
  const credentials = getDeviceCredentials();
  if (!credentials) {
    return null;
  }

  const status: 'healthy' | 'degraded' | 'error' =
    connectionStatus.state === 'connected'
      ? 'healthy'
      : connectionStatus.state === 'error'
        ? 'error'
        : 'degraded';

  return {
    deviceId: credentials.deviceId,
    deviceName: credentials.deviceName,
    status,
    activeSessions: activeSessionCount,
    pendingEvents: getPendingCount(),
    policyVersion: getPolicyVersion(),
    version: VERSION,
    system: getSystemInfo(),
    stats: getHeartbeatStats(),
  };
}

/**
 * Send heartbeat to TrustScope API
 */
export async function sendHeartbeat(
  config: BridgeConfig
): Promise<HeartbeatResponse> {
  const request = buildHeartbeatRequest();
  if (!request) {
    throw new Error('No device credentials');
  }

  const startTime = performance.now();

  try {
    const token = await getAccessToken(config);

    const response = await fetch(`${config.apiUrl}/v1/devices/heartbeat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'X-Device-ID': request.deviceId,
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(config.timeoutMs),
    });

    const latency = Math.round(performance.now() - startTime);
    recordLatency(latency);

    if (!response.ok) {
      const error = await response.text();
      setConnectionState('error', `Heartbeat failed: ${response.status}`);
      throw new Error(`Heartbeat failed: ${response.status} ${error}`);
    }

    const data = (await response.json()) as HeartbeatResponse;

    setConnectionState('connected');
    resetStats();

    return data;
  } catch (error) {
    setConnectionState('error', (error as Error).message);
    throw error;
  }
}

// ============================================================================
// Command Processing
// ============================================================================

/**
 * Process commands from heartbeat response
 */
export async function processCommands(
  config: BridgeConfig,
  commands?: DeviceCommand[]
): Promise<void> {
  if (!commands || commands.length === 0) {
    return;
  }

  for (const command of commands) {
    try {
      await executeCommand(config, command);
    } catch {
      // Log but don't fail on command errors
      recordError();
    }
  }
}

/**
 * Execute a device command
 */
async function executeCommand(
  config: BridgeConfig,
  command: DeviceCommand
): Promise<void> {
  switch (command.type) {
    case 'reload_policy':
      await forcePolicyRefresh(config);
      break;

    case 'flush_events':
      await flushEvents(config);
      break;

    case 'disconnect':
      stopHeartbeat();
      setConnectionState('disconnected');
      break;

    case 'restart':
      // Signal restart needed - caller should handle
      break;

    case 'update':
      // Signal update needed - caller should handle
      break;

    default:
      // Unknown command
      break;
  }
}

// ============================================================================
// Background Heartbeat
// ============================================================================

let heartbeatInterval: NodeJS.Timeout | null = null;
let heartbeatConfig: BridgeConfig | null = null;

/**
 * Start background heartbeat
 */
export function startHeartbeat(config: BridgeConfig): void {
  if (heartbeatInterval) {
    return;
  }

  heartbeatConfig = config;
  setConnectionState('connecting');

  // Initial heartbeat
  sendHeartbeat(config)
    .then((response) => {
      processCommands(config, response.commands);
    })
    .catch(() => {
      // Error already tracked
    });

  heartbeatInterval = setInterval(async () => {
    try {
      const response = await sendHeartbeat(config);
      await processCommands(config, response.commands);

      // Check for policy update
      if (response.policyUpdateAvailable) {
        await forcePolicyRefresh(config);
      }
    } catch {
      // Error already tracked
    }
  }, config.heartbeatIntervalMs);
}

/**
 * Stop background heartbeat
 */
export function stopHeartbeat(): void {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
  heartbeatConfig = null;
}

/**
 * Check if heartbeat is running
 */
export function isHeartbeatRunning(): boolean {
  return heartbeatInterval !== null;
}

/**
 * Force a heartbeat now
 */
export async function forceHeartbeat(): Promise<HeartbeatResponse | null> {
  if (!heartbeatConfig) {
    return null;
  }

  return sendHeartbeat(heartbeatConfig);
}

// ============================================================================
// Health Check
// ============================================================================

/**
 * Check overall bridge health
 */
export function getBridgeHealth(): {
  healthy: boolean;
  state: ConnectionState;
  lastHeartbeat?: number;
  pendingEvents: number;
  errorCount: number;
  avgLatencyMs: number;
} {
  const stats = getHeartbeatStats();

  return {
    healthy: connectionStatus.state === 'connected',
    state: connectionStatus.state,
    lastHeartbeat: connectionStatus.lastConnected,
    pendingEvents: getPendingCount(),
    errorCount: stats.errors,
    avgLatencyMs: stats.avgLatencyMs,
  };
}

/**
 * Check if reconnection is needed
 */
export function needsReconnection(maxRetries: number = 5): boolean {
  return (
    connectionStatus.state === 'error' &&
    connectionStatus.retryCount < maxRetries
  );
}

/**
 * Attempt reconnection
 */
export async function reconnect(config: BridgeConfig): Promise<boolean> {
  setConnectionState('reconnecting');

  try {
    await sendHeartbeat(config);
    return true;
  } catch {
    return false;
  }
}
