/**
 * Time Machine Module
 *
 * Provides snapshot and rollback capabilities for filesystem changes.
 */

export {
  SnapshotStore,
  getSnapshotStore,
} from './snapshot.js';

export type {
  Snapshot,
  SnapshotSummary,
  RollbackResult,
} from './snapshot.js';
