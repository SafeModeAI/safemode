/**
 * MCP Wrapper Proxy
 *
 * The main proxy that sits between AI clients and MCP servers.
 * Spawns the original server as a child process and intercepts
 * all JSON-RPC 2.0 messages.
 */

import { EventEmitter } from 'node:events';
import { MCPServerSpawn, type SpawnOptions } from './spawn.js';
import {
  MessageInterceptor,
  type InterceptorConfig,
  type InterceptorDependencies,
} from './interceptor.js';
import { serializeMessage, createBlockedResponse } from './protocol.js';

export interface WrapperConfig extends InterceptorConfig {
  /** Server spawn options */
  spawn: SpawnOptions;
}

export interface WrapperEvents {
  ready: () => void;
  error: (error: Error) => void;
  exit: (code: number | null) => void;
}

/**
 * MCP Wrapper Proxy
 *
 * Usage:
 * ```
 * const wrapper = new MCPWrapper(config, dependencies);
 * await wrapper.start();
 * // Proxy now running - reads from stdin, writes to stdout
 * ```
 */
export class MCPWrapper extends EventEmitter {
  private server: MCPServerSpawn;
  private interceptor: MessageInterceptor;
  private isRunning: boolean = false;
  private stdinBuffer: string = '';

  constructor(
    config: WrapperConfig,
    deps: InterceptorDependencies
  ) {
    super();
    this.server = new MCPServerSpawn(config.spawn);
    this.interceptor = new MessageInterceptor(
      {
        serverName: config.serverName,
        preset: config.preset,
        budget: config.budget,
      },
      deps
    );
  }

  /**
   * Start the proxy
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      throw new Error('Wrapper already running');
    }

    // Set up server event handlers
    this.server.on('message', this.handleServerMessage.bind(this));
    this.server.on('error', this.handleServerError.bind(this));
    this.server.on('exit', this.handleServerExit.bind(this));

    // Set up stdin handlers
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', this.handleStdinData.bind(this));
    process.stdin.on('end', this.handleStdinEnd.bind(this));

    // Spawn the server
    await this.server.spawn();

    this.isRunning = true;
    this.emit('ready');
  }

  /**
   * Stop the proxy
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    this.server.kill();

    // Clean up stdin
    process.stdin.removeAllListeners('data');
    process.stdin.removeAllListeners('end');
  }

  /**
   * Handle data from stdin (client → proxy)
   */
  private async handleStdinData(data: string): Promise<void> {
    this.stdinBuffer += data;

    // Process complete lines
    const lines = this.stdinBuffer.split('\n');
    this.stdinBuffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const result = await this.interceptor.processClientMessage(trimmed);
        if (result) {
          // Forward to server
          this.server.send(result);
        }
      } catch (error) {
        this.handleInterceptError(error as Error, trimmed);
      }
    }
  }

  /**
   * Handle stdin end (client disconnected)
   */
  private handleStdinEnd(): void {
    this.stop();
  }

  /**
   * Handle message from server (server → proxy → client)
   */
  private async handleServerMessage(line: string): Promise<void> {
    try {
      const result = await this.interceptor.processServerMessage(line);
      if (result) {
        // Forward to client
        this.writeToClient(result);
      }
    } catch (error) {
      this.handleInterceptError(error as Error, line);
    }
  }

  /**
   * Handle server error
   */
  private handleServerError(error: Error): void {
    this.emit('error', error);
    this.writeError(`Server error: ${error.message}`);
  }

  /**
   * Handle server exit
   */
  private handleServerExit(code: number | null, signal: string | null): void {
    this.isRunning = false;
    this.emit('exit', code);

    // Exit with same code as server
    if (code !== null) {
      process.exit(code);
    } else if (signal) {
      process.exit(1);
    }
  }

  /**
   * Handle interception errors
   */
  private handleInterceptError(error: Error, originalLine: string): void {
    // Log error
    process.stderr.write(`[Safe Mode] Intercept error: ${error.message}\n`);

    // Try to extract request ID for error response
    try {
      const parsed = JSON.parse(originalLine);
      if (parsed.id !== undefined) {
        const errorResponse = createBlockedResponse(
          parsed.id,
          'internal_error',
          'high',
          `Safe Mode internal error: ${error.message}`
        );
        this.writeToClient(serializeMessage(errorResponse));
      }
    } catch {
      // Can't parse, just log
    }
  }

  /**
   * Write a message to the client (stdout)
   */
  private writeToClient(message: string): void {
    process.stdout.write(message + '\n');
  }

  /**
   * Write an error message to stderr
   */
  private writeError(message: string): void {
    process.stderr.write(`[Safe Mode] ${message}\n`);
  }

  /**
   * Get the interceptor's session state
   */
  getSession() {
    return this.interceptor.getSession();
  }

  /**
   * Check if the proxy is running
   */
  isProxyRunning(): boolean {
    return this.isRunning;
  }
}

/**
 * Create and run a wrapper proxy from command line args
 */
export async function runProxy(
  spawnOptions: SpawnOptions,
  preset: string,
  deps: InterceptorDependencies
): Promise<MCPWrapper> {
  const config: WrapperConfig = {
    serverName: extractServerName(spawnOptions),
    preset,
    budget: getBudgetForPreset(preset),
    spawn: spawnOptions,
  };

  const wrapper = new MCPWrapper(config, deps);

  wrapper.on('error', (error) => {
    process.stderr.write(`[Safe Mode] Error: ${error.message}\n`);
  });

  wrapper.on('ready', () => {
    process.stderr.write(`[Safe Mode] Proxy ready for ${config.serverName}\n`);
  });

  await wrapper.start();

  return wrapper;
}

/**
 * Extract server name from spawn options
 */
function extractServerName(options: SpawnOptions): string {
  // Try to find a recognizable package name
  const args = [options.command, ...options.args].join(' ');

  // Look for npm package patterns
  const npmMatch = args.match(/@[\w-]+\/[\w-]+/);
  if (npmMatch) {
    return npmMatch[0];
  }

  // Look for common patterns
  const patterns = [
    /server-(\w+)/,
    /mcp-(\w+)/,
    /(\w+)-server/,
  ];

  for (const pattern of patterns) {
    const match = args.match(pattern);
    if (match) {
      return match[1] || match[0];
    }
  }

  // Fallback to command name
  return options.command;
}

/**
 * Get budget configuration for a preset
 */
function getBudgetForPreset(preset: string): { maxSessionCost: number; alertAt: number } {
  const defaultBudget = { maxSessionCost: 20, alertAt: 16 };
  const budgets: Record<string, { maxSessionCost: number; alertAt: number }> = {
    yolo: { maxSessionCost: 100, alertAt: 80 },
    coding: defaultBudget,
    personal: { maxSessionCost: 10, alertAt: 8 },
    trading: { maxSessionCost: 50, alertAt: 40 },
    strict: { maxSessionCost: 5, alertAt: 4 },
  };

  return budgets[preset] ?? defaultBudget;
}
