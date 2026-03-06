/**
 * Allowlist Manager
 *
 * Manages temporary and permanent overrides for knob values.
 * - Session overrides: ~/.safemode/session-overrides.json (auto-expires)
 * - Permanent overrides: written directly to ~/.safemode/config.yaml
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { KnobValue } from '../knobs/categories.js';

const SAFEMODE_DIR = path.join(os.homedir(), '.safemode');
const SESSION_OVERRIDES_PATH = path.join(SAFEMODE_DIR, 'session-overrides.json');

/** Override window: 5 minutes */
const OVERRIDE_TTL_MS = 5 * 60 * 1000;

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

/**
 * Reverse map: knob name → CLI action name
 * Used to suggest `safemode allow <action>` in deny reasons
 */
export const KNOB_ACTION_MAP: Record<string, string> = {};
for (const [action, knobs] of Object.entries(ACTION_KNOB_MAP)) {
  for (const knob of knobs) {
    KNOB_ACTION_MAP[knob] = action;
  }
}

/**
 * Maps CLI action names to engine IDs that should be skipped
 * when that action is allowed via session overrides.
 */
export const ACTION_ENGINE_SKIP: Record<string, number[]> = {
  secrets: [10],   // Secrets Scanner
  pii: [9],        // PII Scanner
  commands: [13],  // Command Firewall
};

// ============================================================================
// Session Overrides (--once, auto-expires after 5 minutes)
// ============================================================================

interface SessionOverrideFile {
  /** When the override was created (ISO string) */
  created_at: string;
  /** Knob overrides */
  knobs: Record<string, KnobValue>;
}

export function loadSessionOverrides(): Record<string, KnobValue> {
  try {
    if (fs.existsSync(SESSION_OVERRIDES_PATH)) {
      const content = fs.readFileSync(SESSION_OVERRIDES_PATH, 'utf8');
      const parsed = JSON.parse(content);

      // New format with expiry
      if (parsed.created_at) {
        const age = Date.now() - new Date(parsed.created_at).getTime();
        if (age > OVERRIDE_TTL_MS) {
          // Expired — clean up and return empty
          try { fs.unlinkSync(SESSION_OVERRIDES_PATH); } catch { /* ignore */ }
          return {};
        }
        return parsed.knobs || {};
      }

      // Legacy format (flat knob map, no expiry) — treat as expired
      return parsed;
    }
  } catch {
    // Corrupted file, treat as empty
  }
  return {};
}

export function saveSessionOverride(action: string): void {
  const knobs = ACTION_KNOB_MAP[action];
  if (!knobs) return;

  // Load existing (may be empty if expired)
  const existing = loadSessionOverrides();
  for (const knob of knobs) {
    existing[knob] = 'allow';
  }

  const file: SessionOverrideFile = {
    created_at: new Date().toISOString(),
    knobs: existing,
  };

  if (!fs.existsSync(SAFEMODE_DIR)) {
    fs.mkdirSync(SAFEMODE_DIR, { recursive: true });
  }
  fs.writeFileSync(SESSION_OVERRIDES_PATH, JSON.stringify(file, null, 2));
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
