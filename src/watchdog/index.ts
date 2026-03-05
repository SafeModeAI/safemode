/**
 * Watchdog
 *
 * Auto-recovery system for Safe Mode proxies.
 * Monitors proxy health and restarts on failure.
 */

import { EventEmitter } from 'node:events';
import { spawn, ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { CONFIG_PATHS } from '../config/index.js';

// ============================================================================
// Types
// ============================================================================

export interface WatchdogConfig {
  /** Maximum restart attempts before giving up */
  maxRestarts: number;

  /** Cooldown period between restarts (ms) */
  restartCooldown: number;

  /** Health check interval (ms) */
  healthCheckInterval: number;

  /** Time to consider process stable (ms) */
  stableTime: number;

  /** Log file path */
  logPath?: string;
}

export interface WatchdogState {
  pid: number | null;
  startedAt: Date | null;
  restartCount: number;
  lastRestart: Date | null;
  isHealthy: boolean;
  uptime: number;
}

export type DegradedMode = 'normal' | 'read_only' | 'block_all';

export interface DegradedState {
  mode: DegradedMode;
  since: Date | null;
  crashCount: number;
  windowMs: number;
}

interface ProxyInfo {
  process: ChildProcess;
  serverName: string;
  command: string;
  args: string[];
  startedAt: Date;
  restartCount: number;
}

/** Crash window for degraded mode: 3 crashes in 5 minutes */
const DEGRADED_CRASH_THRESHOLD = 3;
const DEGRADED_WINDOW_MS = 5 * 60 * 1000;

// ============================================================================
// Default Config
// ============================================================================

const DEFAULT_CONFIG: WatchdogConfig = {
  maxRestarts: 5,
  restartCooldown: 1000,
  healthCheckInterval: 5000,
  stableTime: 30000,
  logPath: path.join(CONFIG_PATHS.safemodeDir, 'watchdog.log'),
};

// ============================================================================
// Watchdog
// ============================================================================

export class Watchdog extends EventEmitter {
  private config: WatchdogConfig;
  private proxies: Map<string, ProxyInfo> = new Map();
  private healthCheckTimer: NodeJS.Timeout | null = null;
  private isRunning = false;
  private crashTimestamps: number[] = [];
  private _degradedMode: DegradedMode = 'normal';
  private _degradedSince: Date | null = null;
  private _strictDegraded = false;

  constructor(config: Partial<WatchdogConfig> & { strictDegraded?: boolean } = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this._strictDegraded = config.strictDegraded ?? false;
  }

  /**
   * Get current degraded mode state
   */
  get degradedMode(): DegradedMode {
    return this._degradedMode;
  }

  /**
   * Get full degraded state
   */
  getDegradedState(): DegradedState {
    return {
      mode: this._degradedMode,
      since: this._degradedSince,
      crashCount: this.getRecentCrashCount(),
      windowMs: DEGRADED_WINDOW_MS,
    };
  }

  /**
   * Record a crash and check if we should enter degraded mode
   */
  private recordCrash(): void {
    const now = Date.now();
    this.crashTimestamps.push(now);

    // Remove crashes outside the window
    const cutoff = now - DEGRADED_WINDOW_MS;
    this.crashTimestamps = this.crashTimestamps.filter(ts => ts > cutoff);

    if (this.crashTimestamps.length >= DEGRADED_CRASH_THRESHOLD && this._degradedMode === 'normal') {
      this._degradedMode = this._strictDegraded ? 'block_all' : 'read_only';
      this._degradedSince = new Date();
      this.log(`Entering degraded mode: ${this._degradedMode} (${this.crashTimestamps.length} crashes in ${DEGRADED_WINDOW_MS / 1000}s)`);
      this.emit('degraded', {
        mode: this._degradedMode,
        crashCount: this.crashTimestamps.length,
      });
    }
  }

  private getRecentCrashCount(): number {
    const cutoff = Date.now() - DEGRADED_WINDOW_MS;
    return this.crashTimestamps.filter(ts => ts > cutoff).length;
  }

  /**
   * Start the watchdog
   */
  start(): void {
    if (this.isRunning) return;

    this.isRunning = true;
    this.startHealthCheck();
    this.log('Watchdog started');
  }

  /**
   * Stop the watchdog
   */
  stop(): void {
    if (!this.isRunning) return;

    this.isRunning = false;
    this.stopHealthCheck();

    // Kill all managed proxies
    for (const [id, info] of this.proxies) {
      this.killProxy(id, info);
    }

    this.proxies.clear();
    this.log('Watchdog stopped');
  }

  /**
   * Register a proxy to watch
   */
  watch(
    serverName: string,
    command: string,
    args: string[]
  ): string {
    const id = `${serverName}-${Date.now()}`;

    const process = this.spawnProxy(command, args);

    const info: ProxyInfo = {
      process,
      serverName,
      command,
      args,
      startedAt: new Date(),
      restartCount: 0,
    };

    this.proxies.set(id, info);
    this.setupProcessHandlers(id, info);

    this.log(`Watching proxy: ${serverName} (${id})`);
    this.emit('watch', { id, serverName });

    return id;
  }

  /**
   * Unwatch a proxy
   */
  unwatch(id: string): void {
    const info = this.proxies.get(id);
    if (!info) return;

    this.killProxy(id, info);
    this.proxies.delete(id);

    this.log(`Unwatched proxy: ${info.serverName} (${id})`);
    this.emit('unwatch', { id, serverName: info.serverName });
  }

  /**
   * Get state of all watched proxies
   */
  getState(): Map<string, WatchdogState> {
    const state = new Map<string, WatchdogState>();

    for (const [id, info] of this.proxies) {
      state.set(id, {
        pid: info.process.pid || null,
        startedAt: info.startedAt,
        restartCount: info.restartCount,
        lastRestart: info.restartCount > 0 ? info.startedAt : null,
        isHealthy: !info.process.killed && info.process.exitCode === null,
        uptime: Date.now() - info.startedAt.getTime(),
      });
    }

    return state;
  }

  /**
   * Spawn a proxy process
   */
  private spawnProxy(command: string, args: string[]): ChildProcess {
    const proc = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: false,
    });

    return proc;
  }

  /**
   * Set up process event handlers
   */
  private setupProcessHandlers(id: string, info: ProxyInfo): void {
    const { process } = info;

    process.on('exit', (code, signal) => {
      this.handleExit(id, info, code, signal);
    });

    process.on('error', (error) => {
      this.handleError(id, info, error);
    });

    // Forward stdout/stderr
    process.stdout?.on('data', (data) => {
      this.emit('stdout', { id, data: data.toString() });
    });

    process.stderr?.on('data', (data) => {
      this.emit('stderr', { id, data: data.toString() });
    });
  }

  /**
   * Handle process exit
   */
  private handleExit(
    id: string,
    info: ProxyInfo,
    code: number | null,
    signal: string | null
  ): void {
    this.log(`Proxy exited: ${info.serverName} (code=${code}, signal=${signal})`);
    this.emit('exit', { id, serverName: info.serverName, code, signal });

    // Record crash for degraded mode tracking
    if (code !== 0) {
      this.recordCrash();
    }

    // Check if we should restart
    if (!this.isRunning) return;

    if (info.restartCount >= this.config.maxRestarts) {
      this.log(`Max restarts reached for ${info.serverName}, giving up`);
      this.emit('maxRestarts', { id, serverName: info.serverName });
      this.proxies.delete(id);
      return;
    }

    // Schedule restart
    setTimeout(() => {
      this.restart(id, info);
    }, this.config.restartCooldown);
  }

  /**
   * Handle process error
   */
  private handleError(id: string, info: ProxyInfo, error: Error): void {
    this.log(`Proxy error: ${info.serverName} - ${error.message}`);
    this.emit('error', { id, serverName: info.serverName, error });
  }

  /**
   * Restart a proxy
   */
  private restart(id: string, info: ProxyInfo): void {
    if (!this.isRunning) return;

    this.log(`Restarting proxy: ${info.serverName} (attempt ${info.restartCount + 1})`);

    // Spawn new process
    const newProcess = this.spawnProxy(info.command, info.args);

    // Update info
    info.process = newProcess;
    info.startedAt = new Date();
    info.restartCount++;

    this.setupProcessHandlers(id, info);

    this.emit('restart', {
      id,
      serverName: info.serverName,
      restartCount: info.restartCount,
    });
  }

  /**
   * Kill a proxy
   */
  private killProxy(_id: string, info: ProxyInfo): void {
    try {
      if (!info.process.killed) {
        info.process.kill('SIGTERM');

        // Force kill after 5 seconds
        setTimeout(() => {
          if (!info.process.killed) {
            info.process.kill('SIGKILL');
          }
        }, 5000);
      }
    } catch {
      // Process may already be dead
    }
  }

  /**
   * Start health check timer
   */
  private startHealthCheck(): void {
    this.healthCheckTimer = setInterval(() => {
      this.checkHealth();
    }, this.config.healthCheckInterval);
  }

  /**
   * Stop health check timer
   */
  private stopHealthCheck(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
  }

  /**
   * Check health of all proxies
   */
  private checkHealth(): void {
    for (const [id, info] of this.proxies) {
      const isAlive = !info.process.killed && info.process.exitCode === null;

      if (!isAlive) {
        this.emit('unhealthy', { id, serverName: info.serverName });
      }
    }
  }

  /**
   * Log a message
   */
  private log(message: string): void {
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] ${message}\n`;

    // Console log
    process.stderr.write(`[Watchdog] ${message}\n`);

    // File log
    if (this.config.logPath) {
      try {
        const dir = path.dirname(this.config.logPath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.appendFileSync(this.config.logPath, line);
      } catch {
        // Ignore log errors
      }
    }
  }
}

// ============================================================================
// Singleton
// ============================================================================

let watchdogInstance: Watchdog | null = null;

export function getWatchdog(config?: Partial<WatchdogConfig>): Watchdog {
  if (!watchdogInstance) {
    watchdogInstance = new Watchdog(config);
  }
  return watchdogInstance;
}

export function stopWatchdog(): void {
  if (watchdogInstance) {
    watchdogInstance.stop();
    watchdogInstance = null;
  }
}
