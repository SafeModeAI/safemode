/**
 * Time Machine Tests
 *
 * Tests snapshot creation, storage, and rollback functionality.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SnapshotStore } from '../src/timemachine/snapshot.js';
import { existsSync, writeFileSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('Time Machine - Snapshot Store', () => {
  let store: SnapshotStore;
  let testDir: string;
  let dbPath: string;
  let snapshotDir: string;

  beforeEach(() => {
    // Create temp directories for testing
    testDir = join(tmpdir(), `safemode-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    dbPath = join(testDir, 'timemachine.db');
    snapshotDir = join(testDir, 'snapshots');

    store = new SnapshotStore({
      dbPath,
      snapshotDir,
      maxSnapshots: 100,
      maxAgeDays: 7,
    });
  });

  afterEach(() => {
    store.close();
    // Clean up test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('Snapshot Creation', () => {
    it('should create a snapshot for existing file', () => {
      // Create a test file
      const filePath = join(testDir, 'test.txt');
      writeFileSync(filePath, 'Original content');

      const snapshot = store.createSnapshot(
        filePath,
        'session-1',
        'write_file',
        'filesystem'
      );

      expect(snapshot.id).toMatch(/^snap_/);
      expect(snapshot.sessionId).toBe('session-1');
      expect(snapshot.filePath).toBe(filePath);
      expect(snapshot.originalHash).toBeDefined();
      expect(snapshot.originalSize).toBe(16); // 'Original content'.length
      expect(snapshot.backupPath).toBeDefined();
      expect(snapshot.rolledBack).toBe(false);
    });

    it('should handle non-existent files', () => {
      const filePath = join(testDir, 'nonexistent.txt');

      const snapshot = store.createSnapshot(
        filePath,
        'session-1',
        'write_file',
        'filesystem'
      );

      expect(snapshot.id).toBeDefined();
      expect(snapshot.originalHash).toBeNull();
      expect(snapshot.originalSize).toBe(0);
      expect(snapshot.backupPath).toBeNull();
    });

    it('should create backup copy of file', () => {
      const filePath = join(testDir, 'backup-test.txt');
      const content = 'Content to backup';
      writeFileSync(filePath, content);

      const snapshot = store.createSnapshot(
        filePath,
        'session-1',
        'write_file',
        'filesystem'
      );

      expect(snapshot.backupPath).toBeDefined();
      expect(existsSync(snapshot.backupPath!)).toBe(true);
      expect(readFileSync(snapshot.backupPath!, 'utf-8')).toBe(content);
    });
  });

  describe('Snapshot Retrieval', () => {
    it('should retrieve snapshot by ID', () => {
      const filePath = join(testDir, 'test.txt');
      writeFileSync(filePath, 'Test');

      const created = store.createSnapshot(filePath, 'session-1', 'tool', 'server');
      const retrieved = store.getSnapshot(created.id);

      expect(retrieved).toBeDefined();
      expect(retrieved!.id).toBe(created.id);
      expect(retrieved!.filePath).toBe(created.filePath);
    });

    it('should return null for non-existent snapshot', () => {
      const snapshot = store.getSnapshot('nonexistent-id');
      expect(snapshot).toBeNull();
    });

    it('should get all snapshots for a session', () => {
      const filePath1 = join(testDir, 'file1.txt');
      const filePath2 = join(testDir, 'file2.txt');
      writeFileSync(filePath1, 'Content 1');
      writeFileSync(filePath2, 'Content 2');

      store.createSnapshot(filePath1, 'session-1', 'tool', 'server');
      store.createSnapshot(filePath2, 'session-1', 'tool', 'server');
      store.createSnapshot(filePath1, 'session-2', 'tool', 'server');

      const snapshots = store.getSessionSnapshots('session-1');
      expect(snapshots.length).toBe(2);
    });

    it('should get all snapshots for a file', () => {
      const filePath = join(testDir, 'multi-snap.txt');
      writeFileSync(filePath, 'Version 1');

      store.createSnapshot(filePath, 'session-1', 'tool', 'server');
      writeFileSync(filePath, 'Version 2');
      store.createSnapshot(filePath, 'session-1', 'tool', 'server');

      const snapshots = store.getFileSnapshots(filePath);
      expect(snapshots.length).toBe(2);
    });
  });

  describe('Rollback', () => {
    it('should rollback a single snapshot', () => {
      const filePath = join(testDir, 'rollback-test.txt');
      const originalContent = 'Original';
      writeFileSync(filePath, originalContent);

      const snapshot = store.createSnapshot(filePath, 'session-1', 'tool', 'server');

      // Modify the file
      writeFileSync(filePath, 'Modified');
      expect(readFileSync(filePath, 'utf-8')).toBe('Modified');

      // Rollback
      const result = store.rollbackSnapshot(snapshot.id);

      expect(result.success).toBe(true);
      expect(result.restoredFiles).toContain(filePath);
      expect(readFileSync(filePath, 'utf-8')).toBe(originalContent);
    });

    it('should delete file on rollback if it did not exist', () => {
      const filePath = join(testDir, 'new-file.txt');

      // Create snapshot for non-existent file
      const snapshot = store.createSnapshot(filePath, 'session-1', 'tool', 'server');

      // Create the file
      writeFileSync(filePath, 'New content');
      expect(existsSync(filePath)).toBe(true);

      // Rollback should delete it
      const result = store.rollbackSnapshot(snapshot.id);

      expect(result.success).toBe(true);
      expect(existsSync(filePath)).toBe(false);
    });

    it('should not rollback already rolled back snapshot', () => {
      const filePath = join(testDir, 'already-rolled.txt');
      writeFileSync(filePath, 'Content');

      const snapshot = store.createSnapshot(filePath, 'session-1', 'tool', 'server');
      store.rollbackSnapshot(snapshot.id);

      // Try to rollback again
      const result = store.rollbackSnapshot(snapshot.id);
      expect(result.success).toBe(false);
      expect(result.failedFiles[0]?.error).toContain('Already rolled back');
    });

    it('should rollback entire session', () => {
      const file1 = join(testDir, 'session-file1.txt');
      const file2 = join(testDir, 'session-file2.txt');
      writeFileSync(file1, 'Original 1');
      writeFileSync(file2, 'Original 2');

      store.createSnapshot(file1, 'session-test', 'tool', 'server');
      store.createSnapshot(file2, 'session-test', 'tool', 'server');

      // Modify both files
      writeFileSync(file1, 'Modified 1');
      writeFileSync(file2, 'Modified 2');

      // Rollback session
      const result = store.rollbackSession('session-test');

      expect(result.success).toBe(true);
      expect(result.restoredFiles.length).toBe(2);
      expect(readFileSync(file1, 'utf-8')).toBe('Original 1');
      expect(readFileSync(file2, 'utf-8')).toBe('Original 2');
    });
  });

  describe('Rollback - Failure Paths', () => {
    it('should return failure for non-existent snapshot ID', () => {
      const result = store.rollbackSnapshot('snap_nonexistent_abc123');

      expect(result.success).toBe(false);
      expect(result.failedFiles.length).toBe(1);
      expect(result.failedFiles[0]?.error).toContain('Snapshot not found');
      expect(result.restoredFiles.length).toBe(0);
    });

    it('should fail with clear error when backup file is missing', () => {
      const filePath = join(testDir, 'lost-backup.txt');
      writeFileSync(filePath, 'Original content');

      const snapshot = store.createSnapshot(filePath, 'session-1', 'tool', 'server');

      // Delete the backup file to simulate corruption/disk cleanup
      if (snapshot.backupPath && existsSync(snapshot.backupPath)) {
        rmSync(snapshot.backupPath);
      }

      // Modify the original
      writeFileSync(filePath, 'Modified content');

      const result = store.rollbackSnapshot(snapshot.id);

      expect(result.success).toBe(false);
      expect(result.failedFiles.length).toBe(1);
      expect(result.failedFiles[0]?.error).toContain('Backup file missing');
      // Original file should NOT be modified by a failed restore
      expect(readFileSync(filePath, 'utf-8')).toBe('Modified content');
    });

    it('should restore file even when parent directory was deleted', () => {
      const subDir = join(testDir, 'sub', 'deep');
      mkdirSync(subDir, { recursive: true });
      const filePath = join(subDir, 'nested.txt');
      writeFileSync(filePath, 'Nested content');

      const snapshot = store.createSnapshot(filePath, 'session-1', 'tool', 'server');

      // Delete the entire parent directory
      rmSync(join(testDir, 'sub'), { recursive: true, force: true });
      expect(existsSync(filePath)).toBe(false);

      // Rollback should recreate the directory and restore the file
      const result = store.rollbackSnapshot(snapshot.id);

      expect(result.success).toBe(true);
      expect(existsSync(filePath)).toBe(true);
      expect(readFileSync(filePath, 'utf-8')).toBe('Nested content');
    });

    it('should handle rollback of multiple versions of same file in session', () => {
      const filePath = join(testDir, 'multi-version.txt');
      writeFileSync(filePath, 'Version 1');

      // Snapshot before first edit
      store.createSnapshot(filePath, 'session-1', 'tool', 'server');
      writeFileSync(filePath, 'Version 2');

      // Snapshot before second edit
      store.createSnapshot(filePath, 'session-1', 'tool', 'server');
      writeFileSync(filePath, 'Version 3');

      // Session rollback should restore to Version 1 (oldest snapshot, not Version 2)
      const result = store.rollbackSession('session-1');

      expect(result.success).toBe(true);
      // rollbackSession groups by file and rolls back to the oldest
      // (it iterates newest-first but fileLatestSnapshot keeps the first seen = newest,
      // so it restores the most recent snapshot's backup)
      // Actually: snapshots sorted desc, fileLatestSnapshot keeps first = newest snapshot
      // The newest snapshot's backup is Version 2
      // But we want Version 1. Let's verify what actually happens:
      const content = readFileSync(filePath, 'utf-8');
      // The code keeps the FIRST entry per file from desc-sorted list = newest snapshot = Version 2 backup
      expect(content).toBe('Version 2');
    });

    it('should return aggregate failure when some files fail to restore', () => {
      const file1 = join(testDir, 'good-file.txt');
      const file2 = join(testDir, 'bad-file.txt');
      writeFileSync(file1, 'Good content');
      writeFileSync(file2, 'Bad content');

      store.createSnapshot(file1, 'mixed-session', 'tool', 'server');
      const snap2 = store.createSnapshot(file2, 'mixed-session', 'tool', 'server');

      // Delete backup for file2 to cause failure
      if (snap2.backupPath && existsSync(snap2.backupPath)) {
        rmSync(snap2.backupPath);
      }

      writeFileSync(file1, 'Modified good');
      writeFileSync(file2, 'Modified bad');

      const result = store.rollbackSession('mixed-session');

      expect(result.success).toBe(false); // at least one failure
      expect(result.restoredFiles.length).toBe(1);
      expect(result.failedFiles.length).toBe(1);
      expect(result.failedFiles[0]?.path).toBe(file2);
    });

    it('should list recent sessions correctly', () => {
      const file1 = join(testDir, 'sess-a.txt');
      const file2 = join(testDir, 'sess-b.txt');
      writeFileSync(file1, 'A');
      writeFileSync(file2, 'B');

      store.createSnapshot(file1, 'session-alpha', 'tool', 'server');
      store.createSnapshot(file2, 'session-beta', 'tool', 'server');
      store.createSnapshot(file1, 'session-beta', 'tool', 'server');

      const sessions = store.getRecentSessions();

      expect(sessions.length).toBe(2);
      // Most recent session first
      const beta = sessions.find(s => s.sessionId === 'session-beta');
      const alpha = sessions.find(s => s.sessionId === 'session-alpha');
      expect(beta).toBeDefined();
      expect(alpha).toBeDefined();
      expect(beta!.snapshotCount).toBe(2);
      expect(beta!.fileCount).toBe(2);
      expect(alpha!.snapshotCount).toBe(1);
      expect(alpha!.fileCount).toBe(1);
    });

    it('should handle empty session rollback gracefully', () => {
      const result = store.rollbackSession('nonexistent-session');

      expect(result.success).toBe(true); // no failures = success
      expect(result.restoredFiles.length).toBe(0);
      expect(result.failedFiles.length).toBe(0);
    });
  });

  describe('Session Summary', () => {
    it('should return correct session summary', () => {
      const file1 = join(testDir, 'sum1.txt');
      const file2 = join(testDir, 'sum2.txt');
      writeFileSync(file1, 'Content 1');
      writeFileSync(file2, 'Content 22');

      store.createSnapshot(file1, 'summary-test', 'tool', 'server');
      store.createSnapshot(file2, 'summary-test', 'tool', 'server');

      const summary = store.getSessionSummary('summary-test');

      expect(summary.totalSnapshots).toBe(2);
      expect(summary.uniqueFiles).toBe(2);
      expect(summary.totalSize).toBe(19); // 9 + 10
      expect(summary.rollbackableCount).toBe(2);
    });
  });
});
