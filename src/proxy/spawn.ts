/**
 * MCP Server Spawner
 *
 * Spawns the original MCP server as a child process and manages
 * bidirectional stdio communication.
 */

import { spawn, ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';

export interface SpawnOptions {
  /** Command to run */
  command: string;

  /** Arguments to pass */
  args: string[];

  /** Working directory */
  cwd?: string;

  /** Environment variables */
  env?: NodeJS.ProcessEnv;

  /** Timeout for startup in ms */
  startupTimeout?: number;
}

export interface ServerEvents {
  message: (data: string) => void;
  error: (error: Error) => void;
  exit: (code: number | null, signal: string | null) => void;
  ready: () => void;
}

/**
 * Manages spawning and communication with an MCP server process
 */
export class MCPServerSpawn extends EventEmitter {
  private process: ChildProcess | null = null;
  private buffer: string = '';
  private isReady: boolean = false;

  constructor(private options: SpawnOptions) {
    super();
  }

  /**
   * Spawn the MCP server process
   */
  async spawn(): Promise<void> {
    return new Promise((resolve, reject) => {
      const { command, args, cwd, env, startupTimeout = 10000 } = this.options;

      // Spawn the process
      this.process = spawn(command, args, {
        cwd,
        env: { ...process.env, ...env },
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
      });

      // Set up timeout for startup
      const timeout = setTimeout(() => {
        if (!this.isReady) {
          const error = new Error(
            `Server startup timeout after ${startupTimeout}ms: ${command} ${args.join(' ')}`
          );
          this.emit('error', error);
          reject(error);
          this.kill();
        }
      }, startupTimeout);

      // Handle stdout (JSON-RPC messages)
      this.process.stdout?.on('data', (data: Buffer) => {
        this.buffer += data.toString();
        this.processBuffer();
      });

      // Handle stderr (logging, errors)
      this.process.stderr?.on('data', (data: Buffer) => {
        const text = data.toString().trim();
        if (text) {
          // Log stderr to our stderr but don't treat as error
          process.stderr.write(`[MCP Server] ${text}\n`);
        }
      });

      // Handle process errors
      this.process.on('error', (error) => {
        clearTimeout(timeout);
        this.emit('error', error);
        reject(error);
      });

      // Handle process exit
      this.process.on('exit', (code, signal) => {
        clearTimeout(timeout);
        this.emit('exit', code, signal);
        this.process = null;
      });

      // Mark as ready immediately - MCP servers don't have a "ready" signal
      // They just start accepting JSON-RPC messages
      this.isReady = true;
      clearTimeout(timeout);
      this.emit('ready');
      resolve();
    });
  }

  /**
   * Process the buffer and emit complete JSON-RPC messages
   */
  private processBuffer(): void {
    // MCP uses newline-delimited JSON
    const lines = this.buffer.split('\n');

    // Keep the last incomplete line in the buffer
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed) {
        this.emit('message', trimmed);
      }
    }
  }

  /**
   * Send a message to the server
   */
  send(message: string): void {
    if (!this.process?.stdin?.writable) {
      throw new Error('Server process not running or stdin not writable');
    }
    this.process.stdin.write(message + '\n');
  }

  /**
   * Kill the server process
   */
  kill(signal: NodeJS.Signals = 'SIGTERM'): void {
    if (this.process) {
      this.process.kill(signal);
      this.process = null;
    }
  }

  /**
   * Check if the server is running
   */
  isRunning(): boolean {
    return this.process !== null && this.process.exitCode === null;
  }

  /**
   * Get the process PID
   */
  getPid(): number | undefined {
    return this.process?.pid;
  }
}

/**
 * Parse command line args from "safemode proxy -- command args..."
 */
export function parseProxyArgs(argv: string[]): SpawnOptions | null {
  // Find the -- separator
  const separatorIndex = argv.indexOf('--');
  if (separatorIndex === -1) {
    return null;
  }

  // Everything after -- is the server command
  const serverArgs = argv.slice(separatorIndex + 1);
  if (serverArgs.length === 0) {
    return null;
  }

  const [command, ...args] = serverArgs;
  if (!command) {
    return null;
  }

  return {
    command,
    args,
    cwd: process.cwd(),
  };
}
