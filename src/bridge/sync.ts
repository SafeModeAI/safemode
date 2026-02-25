/**
 * Event Sync
 *
 * Handles batching and uploading of Safe Mode events to TrustScope API.
 */

import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';

import type {
  BridgeConfig,
  SyncEvent,
  SyncBatch,
  SyncResponse,
  SyncError,
} from './types.js';
import { getAccessToken, getDeviceCredentials } from './auth.js';

// ============================================================================
// Constants
// ============================================================================

const PENDING_EVENTS_FILE = join(homedir(), '.safemode', 'pending_events.json');
const SYNC_STATE_FILE = join(homedir(), '.safemode', 'sync_state.json');

// ============================================================================
// Event Queue
// ============================================================================

interface SyncState {
  lastSyncTime: number;
  lastSequence: number;
  failedBatches: string[];
  totalSynced: number;
  totalFailed: number;
}

let eventQueue: SyncEvent[] = [];
let syncState: SyncState = {
  lastSyncTime: 0,
  lastSequence: 0,
  failedBatches: [],
  totalSynced: 0,
  totalFailed: 0,
};

/**
 * Load pending events from disk
 */
function loadPendingEvents(): void {
  if (existsSync(PENDING_EVENTS_FILE)) {
    try {
      const content = readFileSync(PENDING_EVENTS_FILE, 'utf8');
      eventQueue = JSON.parse(content) as SyncEvent[];
    } catch {
      eventQueue = [];
    }
  }
}

/**
 * Save pending events to disk
 */
function savePendingEvents(): void {
  const dir = dirname(PENDING_EVENTS_FILE);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(PENDING_EVENTS_FILE, JSON.stringify(eventQueue), 'utf8');
}

/**
 * Load sync state from disk
 */
function loadSyncState(): void {
  if (existsSync(SYNC_STATE_FILE)) {
    try {
      const content = readFileSync(SYNC_STATE_FILE, 'utf8');
      syncState = { ...syncState, ...JSON.parse(content) };
    } catch {
      // Keep defaults
    }
  }
}

/**
 * Save sync state to disk
 */
function saveSyncState(): void {
  const dir = dirname(SYNC_STATE_FILE);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(SYNC_STATE_FILE, JSON.stringify(syncState), 'utf8');
}

// Initialize on module load
loadPendingEvents();
loadSyncState();

// ============================================================================
// Event Queue Management
// ============================================================================

/**
 * Add event to sync queue
 */
export function queueEvent(event: Omit<SyncEvent, 'id' | 'timestamp'>): void {
  const fullEvent: SyncEvent = {
    ...event,
    id: randomUUID(),
    timestamp: new Date().toISOString(),
  };

  eventQueue.push(fullEvent);
  savePendingEvents();
}

/**
 * Get pending event count
 */
export function getPendingCount(): number {
  return eventQueue.length;
}

/**
 * Get sync statistics
 */
export function getSyncStats(): {
  pending: number;
  synced: number;
  failed: number;
  lastSync: number;
} {
  return {
    pending: eventQueue.length,
    synced: syncState.totalSynced,
    failed: syncState.totalFailed,
    lastSync: syncState.lastSyncTime,
  };
}

// ============================================================================
// Batch Management
// ============================================================================

/**
 * Create batch from queued events
 */
function createBatch(maxSize: number): SyncBatch | null {
  if (eventQueue.length === 0) {
    return null;
  }

  const credentials = getDeviceCredentials();
  if (!credentials) {
    return null;
  }

  const events = eventQueue.slice(0, maxSize);
  syncState.lastSequence++;

  return {
    batchId: randomUUID(),
    deviceId: credentials.deviceId,
    events,
    timestamp: new Date().toISOString(),
    sequence: syncState.lastSequence,
  };
}

/**
 * Remove events from queue after successful sync
 */
function removeSyncedEvents(count: number): void {
  eventQueue = eventQueue.slice(count);
  savePendingEvents();
}

// ============================================================================
// Sync Operations
// ============================================================================

/**
 * Sync a single batch to the API
 */
async function syncBatch(
  config: BridgeConfig,
  batch: SyncBatch
): Promise<SyncResponse> {
  const token = await getAccessToken(config);

  const response = await fetch(`${config.apiUrl}/v1/events/batch`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'X-Device-ID': batch.deviceId,
      'X-Batch-ID': batch.batchId,
      'X-Sequence': String(batch.sequence),
    },
    body: JSON.stringify(batch),
    signal: AbortSignal.timeout(config.timeoutMs),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Batch sync failed: ${response.status} ${error}`);
  }

  return (await response.json()) as SyncResponse;
}

/**
 * Retry failed batch with exponential backoff
 */
async function syncBatchWithRetry(
  config: BridgeConfig,
  batch: SyncBatch,
  attempt: number = 0
): Promise<SyncResponse> {
  try {
    return await syncBatch(config, batch);
  } catch (error) {
    if (attempt < config.maxRetries) {
      const delay = config.retryDelayMs * Math.pow(2, attempt);
      await new Promise((resolve) => setTimeout(resolve, delay));
      return syncBatchWithRetry(config, batch, attempt + 1);
    }
    throw error;
  }
}

/**
 * Sync all pending events
 */
export async function syncAll(config: BridgeConfig): Promise<{
  success: boolean;
  synced: number;
  failed: number;
  errors: SyncError[];
}> {
  const results = {
    success: true,
    synced: 0,
    failed: 0,
    errors: [] as SyncError[],
  };

  while (eventQueue.length > 0) {
    const batch = createBatch(config.batchSize);
    if (!batch) break;

    try {
      const response = await syncBatchWithRetry(config, batch);

      results.synced += response.processed;
      results.failed += response.failed;

      if (response.errors) {
        results.errors.push(...response.errors);
      }

      // Remove synced events
      removeSyncedEvents(batch.events.length);

      // Update stats
      syncState.totalSynced += response.processed;
      syncState.totalFailed += response.failed;
      syncState.lastSyncTime = Date.now();
      saveSyncState();
    } catch (error) {
      results.success = false;
      results.failed += batch.events.length;

      // Track failed batch
      syncState.failedBatches.push(batch.batchId);
      syncState.totalFailed += batch.events.length;
      saveSyncState();

      // Add error for each event
      for (const event of batch.events) {
        results.errors.push({
          eventId: event.id,
          error: (error as Error).message,
          retryable: true,
        });
      }

      // Don't remove events - they'll be retried
      break;
    }
  }

  return results;
}

/**
 * Flush all events immediately
 */
export async function flushEvents(config: BridgeConfig): Promise<{
  success: boolean;
  count: number;
}> {
  const count = eventQueue.length;

  if (count === 0) {
    return { success: true, count: 0 };
  }

  const result = await syncAll(config);

  return {
    success: result.success && result.failed === 0,
    count: result.synced,
  };
}

// ============================================================================
// Background Sync
// ============================================================================

let syncInterval: NodeJS.Timeout | null = null;

/**
 * Start background sync
 */
export function startBackgroundSync(config: BridgeConfig): void {
  if (syncInterval) {
    return;
  }

  syncInterval = setInterval(async () => {
    if (eventQueue.length > 0) {
      try {
        await syncAll(config);
      } catch {
        // Errors are tracked in sync state
      }
    }
  }, config.syncIntervalMs);
}

/**
 * Stop background sync
 */
export function stopBackgroundSync(): void {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
  }
}

/**
 * Check if background sync is running
 */
export function isBackgroundSyncRunning(): boolean {
  return syncInterval !== null;
}

// ============================================================================
// Event Helpers
// ============================================================================

/**
 * Queue a tool call event
 */
export function queueToolCallEvent(
  sessionId: string,
  toolName: string,
  serverName: string,
  outcome: 'allow' | 'alert' | 'block',
  details?: Record<string, unknown>
): void {
  queueEvent({
    sessionId,
    type: 'tool_call',
    toolName,
    serverName,
    action: outcome,
    details,
  });
}

/**
 * Queue a detection event
 */
export function queueDetectionEvent(
  sessionId: string,
  toolName: string,
  serverName: string,
  engineResults: SyncEvent['engineResults'],
  riskLevel: SyncEvent['riskLevel']
): void {
  queueEvent({
    sessionId,
    type: 'detection',
    toolName,
    serverName,
    engineResults,
    riskLevel,
  });
}

/**
 * Queue a block event
 */
export function queueBlockEvent(
  sessionId: string,
  toolName: string,
  serverName: string,
  reason: string,
  triggeredBy: string
): void {
  queueEvent({
    sessionId,
    type: 'block',
    toolName,
    serverName,
    action: 'block',
    details: {
      reason,
      triggeredBy,
    },
  });
}

/**
 * Queue a session start event
 */
export function queueSessionStartEvent(sessionId: string, serverName: string): void {
  queueEvent({
    sessionId,
    type: 'session_start',
    serverName,
  });
}

/**
 * Queue a session end event
 */
export function queueSessionEndEvent(
  sessionId: string,
  stats: {
    toolCalls: number;
    detections: number;
    blocks: number;
    durationMs: number;
  }
): void {
  queueEvent({
    sessionId,
    type: 'session_end',
    details: stats,
  });
}

/**
 * Clear all pending events (use with caution)
 */
export function clearPendingEvents(): void {
  eventQueue = [];
  savePendingEvents();
}
