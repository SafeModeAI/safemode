/**
 * Bridge Authentication
 *
 * Handles smdev_ token exchange and credential management for Safe Mode devices.
 */

import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';

import type {
  DeviceCredentials,
  TokenExchangeRequest,
  TokenExchangeResponse,
  BridgeConfig,
} from './types.js';

// ============================================================================
// Constants
// ============================================================================

const CREDENTIALS_FILE = join(homedir(), '.safemode', 'credentials.json');
const TOKEN_CACHE_FILE = join(homedir(), '.safemode', 'token_cache.json');
const SMDEV_PREFIX = 'smdev_';

// ============================================================================
// Device ID Management
// ============================================================================

/**
 * Generate a unique device ID
 */
export function generateDeviceId(): string {
  return `sm_${randomUUID().replace(/-/g, '').substring(0, 16)}`;
}

/**
 * Get or create device credentials
 */
export function getDeviceCredentials(): DeviceCredentials | null {
  if (!existsSync(CREDENTIALS_FILE)) {
    return null;
  }

  try {
    const content = readFileSync(CREDENTIALS_FILE, 'utf8');
    return JSON.parse(content) as DeviceCredentials;
  } catch {
    return null;
  }
}

/**
 * Save device credentials
 */
export function saveDeviceCredentials(credentials: DeviceCredentials): void {
  const dir = dirname(CREDENTIALS_FILE);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  writeFileSync(CREDENTIALS_FILE, JSON.stringify(credentials, null, 2), 'utf8');
}

/**
 * Create new device credentials
 */
export function createDeviceCredentials(
  apiKey: string,
  deviceName?: string,
  deviceType: 'cli' | 'mcp_proxy' | 'ide_plugin' = 'mcp_proxy'
): DeviceCredentials {
  const credentials: DeviceCredentials = {
    deviceId: generateDeviceId(),
    apiKey,
    deviceName: deviceName || hostname(),
    deviceType,
  };

  saveDeviceCredentials(credentials);
  return credentials;
}

/**
 * Validate API key format
 */
export function validateApiKey(apiKey: string): { valid: boolean; error?: string } {
  if (!apiKey) {
    return { valid: false, error: 'API key is required' };
  }

  if (!apiKey.startsWith(SMDEV_PREFIX) && !apiKey.startsWith('ts_')) {
    return {
      valid: false,
      error: `API key must start with '${SMDEV_PREFIX}' (Safe Mode device) or 'ts_' (TrustScope)`,
    };
  }

  if (apiKey.length < 20) {
    return { valid: false, error: 'API key is too short' };
  }

  return { valid: true };
}

// ============================================================================
// Token Cache
// ============================================================================

interface TokenCache {
  accessToken: string;
  expiresAt: number;
  orgId: string;
  tier: string;
}

/**
 * Get cached token
 */
export function getCachedToken(): TokenCache | null {
  if (!existsSync(TOKEN_CACHE_FILE)) {
    return null;
  }

  try {
    const content = readFileSync(TOKEN_CACHE_FILE, 'utf8');
    const cache = JSON.parse(content) as TokenCache;

    // Check if expired (with 5 minute buffer)
    if (cache.expiresAt < Date.now() + 5 * 60 * 1000) {
      return null;
    }

    return cache;
  } catch {
    return null;
  }
}

/**
 * Save token to cache
 */
export function cacheToken(response: TokenExchangeResponse): void {
  const dir = dirname(TOKEN_CACHE_FILE);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const cache: TokenCache = {
    accessToken: response.accessToken,
    expiresAt: response.expiresAt,
    orgId: response.orgId,
    tier: response.tier,
  };

  writeFileSync(TOKEN_CACHE_FILE, JSON.stringify(cache, null, 2), 'utf8');
}

/**
 * Clear token cache
 */
export function clearTokenCache(): void {
  if (existsSync(TOKEN_CACHE_FILE)) {
    try {
      writeFileSync(TOKEN_CACHE_FILE, '{}', 'utf8');
    } catch {
      // Ignore errors
    }
  }
}

// ============================================================================
// Token Exchange
// ============================================================================

/**
 * Exchange device credentials for access token
 */
export async function exchangeToken(
  config: BridgeConfig,
  credentials: DeviceCredentials,
  scopes: string[] = ['events:write', 'policies:read']
): Promise<TokenExchangeResponse> {
  const request: TokenExchangeRequest = {
    credentials,
    scopes,
    ttlSeconds: 3600, // 1 hour
  };

  const response = await fetch(`${config.apiUrl}/v1/auth/device/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${credentials.apiKey}`,
      'X-Device-ID': credentials.deviceId,
    },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(config.timeoutMs),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token exchange failed: ${response.status} ${error}`);
  }

  const tokenResponse = (await response.json()) as TokenExchangeResponse;

  // Cache the token
  cacheToken(tokenResponse);

  return tokenResponse;
}

/**
 * Get valid access token (from cache or exchange)
 */
export async function getAccessToken(config: BridgeConfig): Promise<string> {
  // Check cache first
  const cached = getCachedToken();
  if (cached) {
    return cached.accessToken;
  }

  // Get credentials
  const credentials = getDeviceCredentials();
  if (!credentials) {
    throw new Error('No device credentials found. Run `safemode connect` first.');
  }

  // Exchange for token
  const response = await exchangeToken(config, credentials);
  return response.accessToken;
}

/**
 * Refresh token if needed
 */
export async function refreshTokenIfNeeded(config: BridgeConfig): Promise<string> {
  const cached = getCachedToken();

  // If token expires in less than 10 minutes, refresh
  if (!cached || cached.expiresAt < Date.now() + 10 * 60 * 1000) {
    return getAccessToken(config);
  }

  return cached.accessToken;
}

// ============================================================================
// Connection Verification
// ============================================================================

/**
 * Verify connection to TrustScope API
 */
export async function verifyConnection(config: BridgeConfig): Promise<{
  connected: boolean;
  orgId?: string;
  tier?: string;
  error?: string;
}> {
  try {
    const token = await getAccessToken(config);

    const response = await fetch(`${config.apiUrl}/v1/auth/verify`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      signal: AbortSignal.timeout(config.timeoutMs),
    });

    if (!response.ok) {
      return { connected: false, error: `API returned ${response.status}` };
    }

    const data = (await response.json()) as { orgId: string; tier: string };

    return {
      connected: true,
      orgId: data.orgId,
      tier: data.tier,
    };
  } catch (error) {
    return {
      connected: false,
      error: (error as Error).message,
    };
  }
}

// ============================================================================
// Credential Cleanup
// ============================================================================

/**
 * Remove all stored credentials and tokens
 */
export function clearCredentials(): void {
  clearTokenCache();

  if (existsSync(CREDENTIALS_FILE)) {
    try {
      writeFileSync(CREDENTIALS_FILE, '{}', 'utf8');
    } catch {
      // Ignore errors
    }
  }
}

/**
 * Check if device is registered
 */
export function isDeviceRegistered(): boolean {
  const credentials = getDeviceCredentials();
  return credentials !== null && !!credentials.deviceId && !!credentials.apiKey;
}
