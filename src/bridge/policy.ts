/**
 * Policy Sync
 *
 * Handles pulling and merging cloud policies from TrustScope API.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';

import type {
  BridgeConfig,
  CloudPolicy,
  PolicyPullResponse,
  KnobOverride,
} from './types.js';
import { getAccessToken, getDeviceCredentials } from './auth.js';

// ============================================================================
// Constants
// ============================================================================

const POLICY_CACHE_FILE = join(homedir(), '.safemode', 'cloud_policies.json');
const POLICY_STATE_FILE = join(homedir(), '.safemode', 'policy_state.json');

// ============================================================================
// Policy Cache
// ============================================================================

interface PolicyState {
  version: number;
  hash: string;
  lastPull: number;
  lastApplied: number;
}

let cachedPolicies: CloudPolicy[] = [];
let policyState: PolicyState = {
  version: 0,
  hash: '',
  lastPull: 0,
  lastApplied: 0,
};

/**
 * Load cached policies from disk
 */
function loadCachedPolicies(): void {
  if (existsSync(POLICY_CACHE_FILE)) {
    try {
      const content = readFileSync(POLICY_CACHE_FILE, 'utf8');
      cachedPolicies = JSON.parse(content) as CloudPolicy[];
    } catch {
      cachedPolicies = [];
    }
  }

  if (existsSync(POLICY_STATE_FILE)) {
    try {
      const content = readFileSync(POLICY_STATE_FILE, 'utf8');
      policyState = { ...policyState, ...JSON.parse(content) };
    } catch {
      // Keep defaults
    }
  }
}

/**
 * Save policies to cache
 */
function savePolicies(policies: CloudPolicy[], version: number, hash: string): void {
  const dir = dirname(POLICY_CACHE_FILE);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  cachedPolicies = policies;
  writeFileSync(POLICY_CACHE_FILE, JSON.stringify(policies, null, 2), 'utf8');

  policyState = {
    version,
    hash,
    lastPull: Date.now(),
    lastApplied: Date.now(),
  };
  writeFileSync(POLICY_STATE_FILE, JSON.stringify(policyState), 'utf8');
}

// Initialize on module load
loadCachedPolicies();

// ============================================================================
// Policy Pull
// ============================================================================

/**
 * Pull policies from TrustScope API
 */
export async function pullPolicies(config: BridgeConfig): Promise<PolicyPullResponse> {
  const token = await getAccessToken(config);
  const credentials = getDeviceCredentials();

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
  };

  if (credentials) {
    headers['X-Device-ID'] = credentials.deviceId;
  }

  // Include current version for conditional fetch
  if (policyState.version > 0) {
    headers['If-None-Match'] = policyState.hash;
  }

  const response = await fetch(`${config.apiUrl}/v1/policies/device`, {
    method: 'GET',
    headers,
    signal: AbortSignal.timeout(config.timeoutMs),
  });

  // 304 Not Modified - use cached
  if (response.status === 304) {
    return {
      policies: cachedPolicies,
      version: policyState.version,
      lastUpdated: new Date(policyState.lastPull).toISOString(),
      hash: policyState.hash,
    };
  }

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Policy pull failed: ${response.status} ${error}`);
  }

  const data = (await response.json()) as PolicyPullResponse;

  // Save to cache
  savePolicies(data.policies, data.version, data.hash);

  return data;
}

/**
 * Get current policy version
 */
export function getPolicyVersion(): number {
  return policyState.version;
}

/**
 * Get cached policies
 */
export function getCachedPolicies(): CloudPolicy[] {
  return cachedPolicies;
}

/**
 * Check if policies need refresh
 */
export function needsPolicyRefresh(maxAgeMs: number = 300000): boolean {
  if (policyState.lastPull === 0) {
    return true;
  }
  return Date.now() - policyState.lastPull > maxAgeMs;
}

// ============================================================================
// Knob Override Extraction
// ============================================================================

/**
 * Extract all knob overrides from policies
 */
export function extractKnobOverrides(policies?: CloudPolicy[]): KnobOverride[] {
  const source = policies || cachedPolicies;
  const overrides: KnobOverride[] = [];

  for (const policy of source) {
    if (!policy.enabled) continue;

    if (policy.knobOverrides) {
      overrides.push(...policy.knobOverrides);
    }

    // Also extract from policy config if it has knob settings
    if (policy.config?.knobs && typeof policy.config.knobs === 'object') {
      const knobConfig = policy.config.knobs as Record<string, Record<string, string>>;

      for (const [category, knobs] of Object.entries(knobConfig)) {
        for (const [knob, value] of Object.entries(knobs)) {
          if (value === 'allow' || value === 'approve' || value === 'block') {
            overrides.push({
              category,
              knob,
              value: value as 'allow' | 'approve' | 'block',
              reason: `From policy: ${policy.name}`,
            });
          }
        }
      }
    }
  }

  return overrides;
}

/**
 * Merge knob overrides with strictest-wins
 */
export function mergeKnobOverrides(
  base: Record<string, Record<string, 'allow' | 'approve' | 'block'>>,
  overrides: KnobOverride[]
): Record<string, Record<string, 'allow' | 'approve' | 'block'>> {
  const result = JSON.parse(JSON.stringify(base)) as Record<
    string,
    Record<string, 'allow' | 'approve' | 'block'>
  >;

  const order = { allow: 0, approve: 1, block: 2 };

  for (const override of overrides) {
    if (!result[override.category]) {
      result[override.category] = {};
    }

    const categoryKnobs = result[override.category]!;
    const current = categoryKnobs[override.knob];
    if (!current || order[override.value] > order[current]) {
      categoryKnobs[override.knob] = override.value;
    }
  }

  return result;
}

// ============================================================================
// Policy Matching
// ============================================================================

/**
 * Get policies matching a tool call
 */
export function getMatchingPolicies(
  toolName: string,
  serverName: string,
  action?: string
): CloudPolicy[] {
  return cachedPolicies.filter((policy) => {
    if (!policy.enabled) return false;

    const config = policy.config;

    // Check tool name match
    if (config.tools) {
      const tools = config.tools as string[];
      if (!tools.includes('*') && !tools.includes(toolName)) {
        return false;
      }
    }

    // Check server name match
    if (config.servers) {
      const servers = config.servers as string[];
      if (!servers.includes('*') && !servers.includes(serverName)) {
        return false;
      }
    }

    // Check action match
    if (config.actions && action) {
      const actions = config.actions as string[];
      if (!actions.includes('*') && !actions.includes(action)) {
        return false;
      }
    }

    return true;
  });
}

/**
 * Check if any policy blocks the action
 */
export function shouldBlock(
  toolName: string,
  serverName: string,
  action?: string
): { blocked: boolean; policy?: CloudPolicy; reason?: string } {
  const policies = getMatchingPolicies(toolName, serverName, action);

  for (const policy of policies) {
    if (policy.type === 'block_action') {
      return {
        blocked: true,
        policy,
        reason: policy.config.reason as string || 'Blocked by cloud policy',
      };
    }
  }

  return { blocked: false };
}

/**
 * Check if approval is required
 */
export function requiresApproval(
  toolName: string,
  serverName: string,
  action?: string
): { required: boolean; policy?: CloudPolicy; approvers?: string[] } {
  const policies = getMatchingPolicies(toolName, serverName, action);

  for (const policy of policies) {
    if (policy.type === 'require_approval' || policy.type === 'human_approval') {
      return {
        required: true,
        policy,
        approvers: policy.config.approvers as string[] | undefined,
      };
    }
  }

  return { required: false };
}

// ============================================================================
// Policy Hash
// ============================================================================

/**
 * Compute hash of policy set
 */
export function computePolicyHash(policies: CloudPolicy[]): string {
  const sorted = [...policies].sort((a, b) => a.id.localeCompare(b.id));
  const content = JSON.stringify(sorted);
  return createHash('sha256').update(content).digest('hex').substring(0, 16);
}

/**
 * Check if policies have changed
 */
export function havePoliciesChanged(newPolicies: CloudPolicy[]): boolean {
  const newHash = computePolicyHash(newPolicies);
  return newHash !== policyState.hash;
}

// ============================================================================
// Background Policy Refresh
// ============================================================================

let policyRefreshInterval: NodeJS.Timeout | null = null;

/**
 * Start background policy refresh
 */
export function startPolicyRefresh(
  config: BridgeConfig,
  intervalMs: number = 300000
): void {
  if (policyRefreshInterval) {
    return;
  }

  // Initial pull
  pullPolicies(config).catch(() => {
    // Errors are logged but don't stop refresh
  });

  policyRefreshInterval = setInterval(async () => {
    try {
      await pullPolicies(config);
    } catch {
      // Use cached policies on failure
    }
  }, intervalMs);
}

/**
 * Stop background policy refresh
 */
export function stopPolicyRefresh(): void {
  if (policyRefreshInterval) {
    clearInterval(policyRefreshInterval);
    policyRefreshInterval = null;
  }
}

/**
 * Check if policy refresh is running
 */
export function isPolicyRefreshRunning(): boolean {
  return policyRefreshInterval !== null;
}

/**
 * Force policy refresh
 */
export async function forcePolicyRefresh(config: BridgeConfig): Promise<CloudPolicy[]> {
  const response = await pullPolicies(config);
  return response.policies;
}

/**
 * Clear cached policies
 */
export function clearPolicyCache(): void {
  cachedPolicies = [];
  policyState = {
    version: 0,
    hash: '',
    lastPull: 0,
    lastApplied: 0,
  };

  if (existsSync(POLICY_CACHE_FILE)) {
    try {
      writeFileSync(POLICY_CACHE_FILE, '[]', 'utf8');
    } catch {
      // Ignore
    }
  }

  if (existsSync(POLICY_STATE_FILE)) {
    try {
      writeFileSync(POLICY_STATE_FILE, '{}', 'utf8');
    } catch {
      // Ignore
    }
  }
}
