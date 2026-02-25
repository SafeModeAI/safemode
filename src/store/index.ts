/**
 * SQLite Event Store
 *
 * Persistent storage for events, sessions, schema pins, and quarantine cache.
 * Uses better-sqlite3 for synchronous, fast operations.
 */

import Database from 'better-sqlite3';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { CONFIG_PATHS } from '../config/index.js';

// ============================================================================
// Types
// ============================================================================

export interface EventRecord {
  id?: number;
  session_id: string;
  timestamp?: string;
  event_type: string;
  tool_name?: string;
  server_name?: string;
  risk_level?: string;
  action_type?: string;
  target?: string;
  engines_run?: number;
  engines_triggered?: number;
  latency_ms?: number;
  outcome: string;
  details?: Record<string, unknown>;
}

export interface SessionRecord {
  id: string;
  started_at: string;
  ended_at?: string;
  tool_call_count: number;
  detection_count: number;
  block_count: number;
  total_latency_ms: number;
}

export interface SchemaPinRecord {
  server_name: string;
  tool_name: string;
  schema_hash: string;
  first_seen: string;
  last_seen: string;
}

export interface QuarantineCacheRecord {
  schema_hash: string;
  result: 'clean' | 'suspicious' | 'adversarial';
  confidence: number;
  scanned_at: string;
}

// ============================================================================
// Schema
// ============================================================================

const SCHEMA = `
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  event_type TEXT NOT NULL,
  tool_name TEXT,
  server_name TEXT,
  risk_level TEXT,
  action_type TEXT,
  target TEXT,
  engines_run INTEGER,
  engines_triggered INTEGER,
  latency_ms INTEGER,
  outcome TEXT,
  details TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at TEXT,
  tool_call_count INTEGER DEFAULT 0,
  detection_count INTEGER DEFAULT 0,
  block_count INTEGER DEFAULT 0,
  total_latency_ms INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS schema_pins (
  server_name TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  schema_hash TEXT NOT NULL,
  first_seen TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (server_name, tool_name)
);

CREATE TABLE IF NOT EXISTS quarantine_cache (
  schema_hash TEXT PRIMARY KEY,
  result TEXT NOT NULL,
  confidence REAL,
  scanned_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id);
CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);
CREATE INDEX IF NOT EXISTS idx_events_tool ON events(tool_name);
CREATE INDEX IF NOT EXISTS idx_events_outcome ON events(outcome);
`;

// ============================================================================
// Event Store
// ============================================================================

export class EventStore {
  private db: Database.Database;

  constructor(dbPath?: string) {
    const finalPath = dbPath || path.join(CONFIG_PATHS.safemodeDir, 'safemode.db');

    // Ensure directory exists
    const dir = path.dirname(finalPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(finalPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.exec(SCHEMA);
  }

  /**
   * Log an event
   */
  logEvent(event: EventRecord): number {
    const stmt = this.db.prepare(`
      INSERT INTO events (
        session_id, event_type, tool_name, server_name,
        risk_level, action_type, target, engines_run,
        engines_triggered, latency_ms, outcome, details
      ) VALUES (
        @session_id, @event_type, @tool_name, @server_name,
        @risk_level, @action_type, @target, @engines_run,
        @engines_triggered, @latency_ms, @outcome, @details
      )
    `);

    const result = stmt.run({
      session_id: event.session_id,
      event_type: event.event_type,
      tool_name: event.tool_name || null,
      server_name: event.server_name || null,
      risk_level: event.risk_level || null,
      action_type: event.action_type || null,
      target: event.target || null,
      engines_run: event.engines_run || null,
      engines_triggered: event.engines_triggered || null,
      latency_ms: event.latency_ms || null,
      outcome: event.outcome,
      details: event.details ? JSON.stringify(event.details) : null,
    });

    return result.lastInsertRowid as number;
  }

  /**
   * Get recent events
   */
  getRecentEvents(limit: number = 100): EventRecord[] {
    const stmt = this.db.prepare(`
      SELECT * FROM events
      ORDER BY timestamp DESC
      LIMIT ?
    `);

    const rows = stmt.all(limit) as Array<Record<string, unknown>>;
    return rows.map(this.parseEventRow);
  }

  /**
   * Get events for a session
   */
  getSessionEvents(sessionId: string): EventRecord[] {
    const stmt = this.db.prepare(`
      SELECT * FROM events
      WHERE session_id = ?
      ORDER BY timestamp ASC
    `);

    const rows = stmt.all(sessionId) as Array<Record<string, unknown>>;
    return rows.map(this.parseEventRow);
  }

  /**
   * Get events by outcome
   */
  getEventsByOutcome(outcome: string, limit: number = 100): EventRecord[] {
    const stmt = this.db.prepare(`
      SELECT * FROM events
      WHERE outcome = ?
      ORDER BY timestamp DESC
      LIMIT ?
    `);

    const rows = stmt.all(outcome, limit) as Array<Record<string, unknown>>;
    return rows.map(this.parseEventRow);
  }

  /**
   * Parse event row from database
   */
  private parseEventRow(row: Record<string, unknown>): EventRecord {
    return {
      id: row.id as number,
      session_id: row.session_id as string,
      timestamp: row.timestamp as string,
      event_type: row.event_type as string,
      tool_name: row.tool_name as string | undefined,
      server_name: row.server_name as string | undefined,
      risk_level: row.risk_level as string | undefined,
      action_type: row.action_type as string | undefined,
      target: row.target as string | undefined,
      engines_run: row.engines_run as number | undefined,
      engines_triggered: row.engines_triggered as number | undefined,
      latency_ms: row.latency_ms as number | undefined,
      outcome: row.outcome as string,
      details: row.details ? JSON.parse(row.details as string) : undefined,
    };
  }

  // ==========================================================================
  // Session Methods
  // ==========================================================================

  /**
   * Create a session
   */
  createSession(id: string): void {
    const stmt = this.db.prepare(`
      INSERT INTO sessions (id) VALUES (?)
    `);
    stmt.run(id);
  }

  /**
   * Update session stats
   */
  updateSession(
    id: string,
    stats: {
      tool_call_count?: number;
      detection_count?: number;
      block_count?: number;
      total_latency_ms?: number;
    }
  ): void {
    const updates: string[] = [];
    const params: Record<string, unknown> = { id };

    if (stats.tool_call_count !== undefined) {
      updates.push('tool_call_count = @tool_call_count');
      params.tool_call_count = stats.tool_call_count;
    }
    if (stats.detection_count !== undefined) {
      updates.push('detection_count = @detection_count');
      params.detection_count = stats.detection_count;
    }
    if (stats.block_count !== undefined) {
      updates.push('block_count = @block_count');
      params.block_count = stats.block_count;
    }
    if (stats.total_latency_ms !== undefined) {
      updates.push('total_latency_ms = @total_latency_ms');
      params.total_latency_ms = stats.total_latency_ms;
    }

    if (updates.length > 0) {
      const stmt = this.db.prepare(`
        UPDATE sessions SET ${updates.join(', ')} WHERE id = @id
      `);
      stmt.run(params);
    }
  }

  /**
   * End a session
   */
  endSession(id: string): void {
    const stmt = this.db.prepare(`
      UPDATE sessions SET ended_at = datetime('now') WHERE id = ?
    `);
    stmt.run(id);
  }

  /**
   * Get session
   */
  getSession(id: string): SessionRecord | null {
    const stmt = this.db.prepare(`
      SELECT * FROM sessions WHERE id = ?
    `);
    const row = stmt.get(id) as SessionRecord | undefined;
    return row || null;
  }

  /**
   * Get recent sessions
   */
  getRecentSessions(limit: number = 10): SessionRecord[] {
    const stmt = this.db.prepare(`
      SELECT * FROM sessions
      ORDER BY started_at DESC
      LIMIT ?
    `);
    return stmt.all(limit) as SessionRecord[];
  }

  // ==========================================================================
  // Schema Pin Methods (for TOFU)
  // ==========================================================================

  /**
   * Get schema pin
   */
  getSchemaPin(serverName: string, toolName: string): SchemaPinRecord | null {
    const stmt = this.db.prepare(`
      SELECT * FROM schema_pins
      WHERE server_name = ? AND tool_name = ?
    `);
    const row = stmt.get(serverName, toolName) as SchemaPinRecord | undefined;
    return row || null;
  }

  /**
   * Get all pins for a server
   */
  getServerPins(serverName: string): SchemaPinRecord[] {
    const stmt = this.db.prepare(`
      SELECT * FROM schema_pins
      WHERE server_name = ?
    `);
    return stmt.all(serverName) as SchemaPinRecord[];
  }

  /**
   * Upsert schema pin
   */
  upsertSchemaPin(serverName: string, toolName: string, schemaHash: string): void {
    const stmt = this.db.prepare(`
      INSERT INTO schema_pins (server_name, tool_name, schema_hash)
      VALUES (?, ?, ?)
      ON CONFLICT(server_name, tool_name) DO UPDATE SET
        schema_hash = excluded.schema_hash,
        last_seen = datetime('now')
    `);
    stmt.run(serverName, toolName, schemaHash);
  }

  /**
   * Delete schema pin
   */
  deleteSchemaPin(serverName: string, toolName: string): void {
    const stmt = this.db.prepare(`
      DELETE FROM schema_pins
      WHERE server_name = ? AND tool_name = ?
    `);
    stmt.run(serverName, toolName);
  }

  // ==========================================================================
  // Quarantine Cache Methods
  // ==========================================================================

  /**
   * Get quarantine cache entry
   */
  getQuarantineCache(schemaHash: string): QuarantineCacheRecord | null {
    const stmt = this.db.prepare(`
      SELECT * FROM quarantine_cache WHERE schema_hash = ?
    `);
    const row = stmt.get(schemaHash) as QuarantineCacheRecord | undefined;
    return row || null;
  }

  /**
   * Set quarantine cache entry
   */
  setQuarantineCache(
    schemaHash: string,
    result: 'clean' | 'suspicious' | 'adversarial',
    confidence: number
  ): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO quarantine_cache (schema_hash, result, confidence)
      VALUES (?, ?, ?)
    `);
    stmt.run(schemaHash, result, confidence);
  }

  // ==========================================================================
  // Statistics Methods
  // ==========================================================================

  /**
   * Get summary statistics
   */
  getSummary(since?: Date): {
    total_events: number;
    total_blocks: number;
    total_alerts: number;
    total_allowed: number;
    avg_latency_ms: number;
    top_blocked_tools: Array<{ tool_name: string; count: number }>;
  } {
    const sinceStr = since ? since.toISOString() : '1970-01-01';

    const totalStmt = this.db.prepare(`
      SELECT
        COUNT(*) as total_events,
        SUM(CASE WHEN outcome = 'block' THEN 1 ELSE 0 END) as total_blocks,
        SUM(CASE WHEN outcome = 'alert' THEN 1 ELSE 0 END) as total_alerts,
        SUM(CASE WHEN outcome = 'allowed' THEN 1 ELSE 0 END) as total_allowed,
        AVG(latency_ms) as avg_latency_ms
      FROM events
      WHERE timestamp >= ?
    `);

    const totals = totalStmt.get(sinceStr) as Record<string, number>;

    const topBlockedStmt = this.db.prepare(`
      SELECT tool_name, COUNT(*) as count
      FROM events
      WHERE outcome = 'block' AND timestamp >= ? AND tool_name IS NOT NULL
      GROUP BY tool_name
      ORDER BY count DESC
      LIMIT 10
    `);

    const topBlocked = topBlockedStmt.all(sinceStr) as Array<{
      tool_name: string;
      count: number;
    }>;

    return {
      total_events: totals.total_events || 0,
      total_blocks: totals.total_blocks || 0,
      total_alerts: totals.total_alerts || 0,
      total_allowed: totals.total_allowed || 0,
      avg_latency_ms: totals.avg_latency_ms || 0,
      top_blocked_tools: topBlocked,
    };
  }

  /**
   * Close the database
   */
  close(): void {
    this.db.close();
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let storeInstance: EventStore | null = null;

export function getEventStore(): EventStore {
  if (!storeInstance) {
    storeInstance = new EventStore();
  }
  return storeInstance;
}

export function closeEventStore(): void {
  if (storeInstance) {
    storeInstance.close();
    storeInstance = null;
  }
}
