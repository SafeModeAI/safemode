/**
 * Allowlist Manager
 *
 * Manages temporary and permanent overrides for knob values.
 * - Session overrides: ~/.safemode/session-overrides.json (cleared on init)
 * - Permanent overrides: written directly to ~/.safemode/config.yaml
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { KnobValue } from '../knobs/categories.js';

const SAFEMODE_DIR = path.join(os.homedir(), '.safemode');
const SESSION_OVERRIDES_PATH = path.join(SAFEMODE_DIR, 'session-overrides.json');

// ============================================================================
// Action → Knob Mapping
// ============================================================================

/**
 * Maps CLI action names to the knobs they override
 */
export const ACTION_KNOB_MAP: Record<string, string[]> = {
  secrets: ['credential_read', 'credential_write'],
  pii: ['export', 'data_read'],
  delete: ['file_delete', 'directory_delete', 'db_delete', 'destructive_commands'],
  write: ['file_write', 'db_write'],
  git: ['git_push', 'git_force_push', 'git_branch_delete', 'git_rebase'],
  network: ['http_request', 'network_commands'],
  packages: ['package_installs', 'install', 'update'],
  commands: ['command_exec', 'destructive_commands'],
};

export const VALID_ACTIONS = Object.keys(ACTION_KNOB_MAP);

// ============================================================================
// Session Overrides (--once)
// ============================================================================

export function loadSessionOverrides(): Record<string, KnobValue> {
  try {
    if (fs.existsSync(SESSION_OVERRIDES_PATH)) {
      const content = fs.readFileSync(SESSION_OVERRIDES_PATH, 'utf8');
      return JSON.parse(content);
    }
  } catch {
    // Corrupted file, treat as empty
  }
  return {};
}

export function saveSessionOverride(action: string): void {
  const knobs = ACTION_KNOB_MAP[action];
  if (!knobs) return;

  const overrides = loadSessionOverrides();
  for (const knob of knobs) {
    overrides[knob] = 'allow';
  }

  if (!fs.existsSync(SAFEMODE_DIR)) {
    fs.mkdirSync(SAFEMODE_DIR, { recursive: true });
  }
  fs.writeFileSync(SESSION_OVERRIDES_PATH, JSON.stringify(overrides, null, 2));
}

export function clearSessionOverrides(): void {
  try {
    if (fs.existsSync(SESSION_OVERRIDES_PATH)) {
      fs.unlinkSync(SESSION_OVERRIDES_PATH);
    }
  } catch {
    // Ignore
  }
}
