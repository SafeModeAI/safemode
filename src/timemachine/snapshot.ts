/**
 * Time Machine - Snapshot Storage
 *
 * Creates and manages filesystem snapshots before write operations.
 * Enables rollback of changes made by AI tools.
 */

import { existsSync, mkdirSync, readFileSync, copyFileSync, rmSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import Database from 'better-sqlite3';

// ============================================================================
// Types
// ============================================================================

export interface Snapshot {
  /** Unique snapshot ID */
  id: string;

  /** Session ID this snapshot belongs to */
  sessionId: string;

  /** Original file path */
  filePath: string;

  /** Path to backup file (null if file didn't exist) */
  backupPath: string | null;

  /** SHA-256 hash of original content (null if file didn't exist) */
  originalHash: string | null;

  /** Size in bytes (0 if file didn't exist) */
  originalSize: number;

  /** When the snapshot was created */
  createdAt: Date;

  /** Tool that triggered this snapshot */
  toolName: string;

  /** Server that triggered this snapshot */
  serverName: string;

  /** Git stash ref if snapshot was taken via git stash create */
  gitStashRef: string | null;

  /** Whether this snapshot has been rolled back */
  rolledBack: boolean;

  /** When rollback was performed (null if not rolled back) */
  rolledBackAt: Date | null;
}

export interface SnapshotSummary {
  /** Total snapshots in session */
  totalSnapshots: number;

  /** Total files modified */
  uniqueFiles: number;

  /** Total size of backed up files */
  totalSize: number;

  /** Snapshots that can be rolled back */
  rollbackableCount: number;
}

export interface RollbackResult {
  /** Whether rollback succeeded */
  success: boolean;

  /** Files that were restored */
  restoredFiles: string[];

  /** Files that failed to restore */
  failedFiles: Array<{ path: string; error: string }>;

  /** Snapshot IDs that were rolled back */
  snapshotIds: string[];
}

// ============================================================================
// Snapshot Store
// ============================================================================

export class SnapshotStore {
  private db: Database.Database;
  private snapshotDir: string;
  private maxSnapshots: number;
  private maxAge: number; // in milliseconds

  constructor(options?: {
    dbPath?: string;
    snapshotDir?: string;
    maxSnapshots?: number;
    maxAgeDays?: number;
  }) {
    const safemodeDir = join(homedir(), '.safemode');
    const dbPath = options?.dbPath || join(safemodeDir, 'timemachine.db');
    this.snapshotDir = options?.snapshotDir || join(safemodeDir, 'snapshots');
    this.maxSnapshots = options?.maxSnapshots || 1000;
    this.maxAge = (options?.maxAgeDays || 7) * 24 * 60 * 60 * 1000;

    // Ensure directories exist
    if (!existsSync(safemodeDir)) {
      mkdirSync(safemodeDir, { recursive: true });
    }
    if (!existsSync(this.snapshotDir)) {
      mkdirSync(this.snapshotDir, { recursive: true });
    }

    // Initialize database
    this.db = new Database(dbPath);
    this.initializeSchema();
  }

  /**
   * Initialize database schema
   */
  private initializeSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS snapshots (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        file_path TEXT NOT NULL,
        backup_path TEXT,
        original_hash TEXT,
        original_size INTEGER DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        tool_name TEXT,
        server_name TEXT,
        git_stash_ref TEXT,
        rolled_back INTEGER DEFAULT 0,
        rolled_back_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_snapshots_session ON snapshots(session_id);
      CREATE INDEX IF NOT EXISTS idx_snapshots_file ON snapshots(file_path);
      CREATE INDEX IF NOT EXISTS idx_snapshots_created ON snapshots(created_at);
    `);

    // Migration: add git_stash_ref column if missing
    try {
      this.db.exec('ALTER TABLE snapshots ADD COLUMN git_stash_ref TEXT');
    } catch {
      // Column already exists
    }
  }

  /**
   * Create a snapshot of a file before modification
   */
  createSnapshot(
    filePath: string,
    sessionId: string,
    toolName: string,
    serverName: string
  ): Snapshot {
    const resolvedPath = resolve(filePath);
    const snapshotId = this.generateSnapshotId();
    const createdAt = new Date();

    let backupPath: string | null = null;
    let originalHash: string | null = null;
    let originalSize = 0;
    let gitStashRef: string | null = null;

    // Check if file exists
    if (existsSync(resolvedPath)) {
      try {
        const content = readFileSync(resolvedPath);
        originalHash = createHash('sha256').update(content).digest('hex');
        originalSize = content.length;

        // Try git stash create for git repos (creates a stash commit without modifying worktree)
        gitStashRef = this.tryGitStash(resolvedPath);

        // Always create file backup as fallback
        backupPath = this.createBackupPath(snapshotId, resolvedPath);
        const backupDir = dirname(backupPath);
        if (!existsSync(backupDir)) {
          mkdirSync(backupDir, { recursive: true });
        }
        copyFileSync(resolvedPath, backupPath);
      } catch (error) {
        // File might be unreadable, proceed without backup
        console.warn(`Failed to backup ${resolvedPath}: ${error}`);
      }
    }

    // Store in database
    const stmt = this.db.prepare(`
      INSERT INTO snapshots (
        id, session_id, file_path, backup_path, original_hash,
        original_size, created_at, tool_name, server_name, git_stash_ref
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      snapshotId,
      sessionId,
      resolvedPath,
      backupPath,
      originalHash,
      originalSize,
      createdAt.toISOString(),
      toolName,
      serverName,
      gitStashRef
    );

    // Cleanup old snapshots
    this.cleanup();

    return {
      id: snapshotId,
      sessionId,
      filePath: resolvedPath,
      backupPath,
      originalHash,
      originalSize,
      createdAt,
      toolName,
      serverName,
      gitStashRef,
      rolledBack: false,
      rolledBackAt: null,
    };
  }

  /**
   * Generate unique snapshot ID
   */
  private generateSnapshotId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `snap_${timestamp}_${random}`;
  }

  /**
   * Try to create a git stash ref for a file in a git repo
   */
  private tryGitStash(filePath: string): string | null {
    try {
      const dir = dirname(filePath);
      // Check if we're in a git repo
      execSync('git rev-parse --is-inside-work-tree', { cwd: dir, stdio: 'pipe' });
      // git stash create makes a stash commit without modifying the worktree
      const ref = execSync('git stash create', { cwd: dir, encoding: 'utf8' }).trim();
      return ref || null; // empty string if no changes to stash
    } catch {
      return null;
    }
  }

  /**
   * Create backup file path
   */
  private createBackupPath(snapshotId: string, originalPath: string): string {
    const ext = originalPath.split('.').pop() || '';
    const filename = `${snapshotId}${ext ? '.' + ext : ''}`;
    const dateDir = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    return join(this.snapshotDir, dateDir!, filename);
  }

  /**
   * Get snapshot by ID
   */
  getSnapshot(snapshotId: string): Snapshot | null {
    const row = this.db.prepare('SELECT * FROM snapshots WHERE id = ?').get(snapshotId) as Record<string, unknown> | undefined;
    return row ? this.rowToSnapshot(row) : null;
  }

  /**
   * Get all snapshots for a session
   */
  getSessionSnapshots(sessionId: string): Snapshot[] {
    const rows = this.db.prepare(
      'SELECT * FROM snapshots WHERE session_id = ? ORDER BY created_at DESC'
    ).all(sessionId) as Record<string, unknown>[];
    return rows.map((row) => this.rowToSnapshot(row));
  }

  /**
   * Get all snapshots for a file
   */
  getFileSnapshots(filePath: string): Snapshot[] {
    const resolvedPath = resolve(filePath);
    const rows = this.db.prepare(
      'SELECT * FROM snapshots WHERE file_path = ? ORDER BY created_at DESC'
    ).all(resolvedPath) as Record<string, unknown>[];
    return rows.map((row) => this.rowToSnapshot(row));
  }

  /**
   * Get recent snapshots
   */
  getRecentSnapshots(limit: number = 50): Snapshot[] {
    const rows = this.db.prepare(
      'SELECT * FROM snapshots ORDER BY created_at DESC LIMIT ?'
    ).all(limit) as Record<string, unknown>[];
    return rows.map((row) => this.rowToSnapshot(row));
  }

  /**
   * Rollback a single snapshot
   */
  rollbackSnapshot(snapshotId: string): RollbackResult {
    const snapshot = this.getSnapshot(snapshotId);
    if (!snapshot) {
      return {
        success: false,
        restoredFiles: [],
        failedFiles: [{ path: 'unknown', error: 'Snapshot not found' }],
        snapshotIds: [],
      };
    }

    if (snapshot.rolledBack) {
      return {
        success: false,
        restoredFiles: [],
        failedFiles: [{ path: snapshot.filePath, error: 'Already rolled back' }],
        snapshotIds: [],
      };
    }

    try {
      // Try git stash apply first if available
      if (snapshot.gitStashRef) {
        try {
          const dir = dirname(snapshot.filePath);
          execSync(`git stash apply ${snapshot.gitStashRef}`, { cwd: dir, stdio: 'pipe' });
          // Mark as rolled back and return success
          this.db.prepare(
            "UPDATE snapshots SET rolled_back = 1, rolled_back_at = datetime('now') WHERE id = ?"
          ).run(snapshotId);
          return {
            success: true,
            restoredFiles: [snapshot.filePath],
            failedFiles: [],
            snapshotIds: [snapshotId],
          };
        } catch {
          // Git stash apply failed, fall through to file backup
        }
      }

      if (snapshot.backupPath && existsSync(snapshot.backupPath)) {
        // Restore from file backup
        const dir = dirname(snapshot.filePath);
        if (!existsSync(dir)) {
          mkdirSync(dir, { recursive: true });
        }
        copyFileSync(snapshot.backupPath, snapshot.filePath);
      } else if (snapshot.originalHash === null) {
        // File didn't exist before - delete it
        if (existsSync(snapshot.filePath)) {
          rmSync(snapshot.filePath);
        }
      } else {
        return {
          success: false,
          restoredFiles: [],
          failedFiles: [{ path: snapshot.filePath, error: 'Backup file missing' }],
          snapshotIds: [],
        };
      }

      // Mark as rolled back
      this.db.prepare(
        "UPDATE snapshots SET rolled_back = 1, rolled_back_at = datetime('now') WHERE id = ?"
      ).run(snapshotId);

      return {
        success: true,
        restoredFiles: [snapshot.filePath],
        failedFiles: [],
        snapshotIds: [snapshotId],
      };
    } catch (error) {
      return {
        success: false,
        restoredFiles: [],
        failedFiles: [{ path: snapshot.filePath, error: String(error) }],
        snapshotIds: [],
      };
    }
  }

  /**
   * Rollback all snapshots in a session
   */
  rollbackSession(sessionId: string): RollbackResult {
    const snapshots = this.getSessionSnapshots(sessionId).filter((s) => !s.rolledBack);

    // Sort by created_at descending (roll back newest first)
    snapshots.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    const restoredFiles: string[] = [];
    const failedFiles: Array<{ path: string; error: string }> = [];
    const snapshotIds: string[] = [];

    // Group by file path and only rollback to oldest snapshot per file
    const fileLatestSnapshot = new Map<string, Snapshot>();
    for (const snapshot of snapshots) {
      if (!fileLatestSnapshot.has(snapshot.filePath)) {
        fileLatestSnapshot.set(snapshot.filePath, snapshot);
      }
    }

    for (const [_filePath, snapshot] of fileLatestSnapshot) {
      const result = this.rollbackSnapshot(snapshot.id);
      if (result.success) {
        restoredFiles.push(...result.restoredFiles);
        snapshotIds.push(snapshot.id);
      } else {
        failedFiles.push(...result.failedFiles);
      }
    }

    return {
      success: failedFiles.length === 0,
      restoredFiles,
      failedFiles,
      snapshotIds,
    };
  }

  /**
   * Get session summary
   */
  getSessionSummary(sessionId: string): SnapshotSummary {
    const stats = this.db.prepare(`
      SELECT
        COUNT(*) as total,
        COUNT(DISTINCT file_path) as unique_files,
        COALESCE(SUM(original_size), 0) as total_size,
        SUM(CASE WHEN rolled_back = 0 THEN 1 ELSE 0 END) as rollbackable
      FROM snapshots
      WHERE session_id = ?
    `).get(sessionId) as { total: number; unique_files: number; total_size: number; rollbackable: number } | undefined;

    return {
      totalSnapshots: stats?.total || 0,
      uniqueFiles: stats?.unique_files || 0,
      totalSize: stats?.total_size || 0,
      rollbackableCount: stats?.rollbackable || 0,
    };
  }

  /**
   * Get recent sessions with snapshot info
   */
  getRecentSessions(limit: number = 20): Array<{
    sessionId: string;
    fileCount: number;
    snapshotCount: number;
    createdAt: string;
    latestAt: string;
  }> {
    const rows = this.db.prepare(`
      SELECT
        session_id,
        COUNT(DISTINCT file_path) as file_count,
        COUNT(*) as snapshot_count,
        MIN(created_at) as created_at,
        MAX(created_at) as latest_at
      FROM snapshots
      GROUP BY session_id
      ORDER BY MAX(created_at) DESC
      LIMIT ?
    `).all(limit) as Array<{
      session_id: string;
      file_count: number;
      snapshot_count: number;
      created_at: string;
      latest_at: string;
    }>;

    return rows.map(r => ({
      sessionId: r.session_id,
      fileCount: r.file_count,
      snapshotCount: r.snapshot_count,
      createdAt: r.created_at,
      latestAt: r.latest_at,
    }));
  }

  /**
   * Cleanup old snapshots
   */
  cleanup(): void {
    const cutoff = new Date(Date.now() - this.maxAge).toISOString();

    // Get old snapshots to delete backups
    const oldSnapshots = this.db.prepare(
      'SELECT backup_path FROM snapshots WHERE created_at < ? AND rolled_back = 0'
    ).all(cutoff) as Array<{ backup_path: string | null }>;

    // Delete backup files
    for (const row of oldSnapshots) {
      if (row.backup_path && existsSync(row.backup_path)) {
        try {
          rmSync(row.backup_path);
        } catch {
          // Ignore errors
        }
      }
    }

    // Delete old records
    this.db.prepare('DELETE FROM snapshots WHERE created_at < ?').run(cutoff);

    // Also enforce max snapshots
    const count = (this.db.prepare('SELECT COUNT(*) as cnt FROM snapshots').get() as { cnt: number }).cnt;
    if (count > this.maxSnapshots) {
      const toDelete = count - this.maxSnapshots;
      const oldest = this.db.prepare(
        'SELECT id, backup_path FROM snapshots ORDER BY created_at ASC LIMIT ?'
      ).all(toDelete) as Array<{ id: string; backup_path: string | null }>;

      for (const row of oldest) {
        if (row.backup_path && existsSync(row.backup_path)) {
          try {
            rmSync(row.backup_path);
          } catch {
            // Ignore errors
          }
        }
        this.db.prepare('DELETE FROM snapshots WHERE id = ?').run(row.id);
      }
    }

    // Clean up empty date directories
    this.cleanupEmptyDirs();
  }

  /**
   * Clean up empty snapshot directories
   */
  private cleanupEmptyDirs(): void {
    try {
      const dirs = readdirSync(this.snapshotDir);
      for (const dir of dirs) {
        const dirPath = join(this.snapshotDir, dir);
        try {
          const files = readdirSync(dirPath);
          if (files.length === 0) {
            rmSync(dirPath, { recursive: true });
          }
        } catch {
          // Ignore errors
        }
      }
    } catch {
      // Ignore errors
    }
  }

  /**
   * Convert database row to Snapshot object
   */
  private rowToSnapshot(row: Record<string, unknown>): Snapshot {
    return {
      id: row.id as string,
      sessionId: row.session_id as string,
      filePath: row.file_path as string,
      backupPath: row.backup_path as string | null,
      originalHash: row.original_hash as string | null,
      originalSize: row.original_size as number,
      createdAt: new Date(row.created_at as string),
      toolName: row.tool_name as string,
      serverName: row.server_name as string,
      gitStashRef: (row.git_stash_ref as string | null) ?? null,
      rolledBack: (row.rolled_back as number) === 1,
      rolledBackAt: row.rolled_back_at ? new Date(row.rolled_back_at as string) : null,
    };
  }

  /**
   * Close database connection
   */
  close(): void {
    this.db.close();
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let _snapshotStore: SnapshotStore | null = null;

export function getSnapshotStore(): SnapshotStore {
  if (!_snapshotStore) {
    _snapshotStore = new SnapshotStore();
  }
  return _snapshotStore;
}
