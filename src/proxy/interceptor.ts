/**
 * Message Interceptor
 *
 * Intercepts JSON-RPC 2.0 messages between AI client and MCP server.
 * Implements the Safe Mode governance pipeline.
 */

import { EventEmitter } from 'node:events';
import {
  type JSONRPCRequest,
  type JSONRPCResponse,
  type ToolsListResult,
  type ToolCallParams,
  type MCPTool,
  INTERCEPTED_METHODS,
  isRequest,
  isResponse,
  parseMessage,
  serializeMessage,
  createBlockedResponse,
} from './protocol.js';
import type { ToolCallEffect } from '../cet/types.js';
import type { EngineEvaluationResult, SessionState, ToolCallSignature } from '../engines/base.js';
import { nanoid } from 'nanoid';
import { createHash } from 'node:crypto';

// ============================================================================
// Types
// ============================================================================

export interface InterceptorConfig {
  /** Server name for identification */
  serverName: string;

  /** Preset name */
  preset: string;

  /** Budget configuration */
  budget: {
    maxSessionCost: number;
    alertAt: number;
  };
}

export interface InterceptorDependencies {
  /** Schema quarantine scanner */
  schemaQuarantine: {
    scan(tools: MCPTool[]): Promise<ScanResult>;
  };

  /** ATSP schema rewriter */
  atsp: {
    rewrite(tools: MCPTool[]): MCPTool[];
  };

  /** TOFU pinning */
  tofu: {
    pin(serverName: string, tools: MCPTool[]): Promise<TOFUResult>;
  };

  /** CET classifier */
  cet: {
    classify(toolName: string, params: Record<string, unknown>): ToolCallEffect;
  };

  /** Knob gate */
  knobGate: {
    evaluate(effect: ToolCallEffect): KnobResult;
  };

  /** Engine registry */
  engines: {
    evaluate(
      toolName: string,
      serverName: string,
      params: Record<string, unknown>,
      effect: ToolCallEffect,
      session: SessionState
    ): Promise<EngineEvaluationResult>;
  };

  /** Output quarantine */
  outputQuarantine: {
    scan(response: unknown): Promise<OutputScanResult>;
  };

  /** Event store */
  eventStore: {
    logEvent(event: EventLog): void;
  };

  /** Notification system */
  notifications: {
    notify(severity: string, message: string): void;
  };
}

export interface ScanResult {
  clean: MCPTool[];
  suspicious: MCPTool[];
  adversarial: MCPTool[];
}

export interface TOFUResult {
  newTools: string[];
  changedTools: string[];
  removedTools: string[];
}

export interface KnobResult {
  decision: 'allow' | 'approve' | 'block';
  knob: string;
  reason: string;
}

export interface OutputScanResult {
  clean: boolean;
  suspicious: boolean;
  adversarial: boolean;
  reason?: string;
}

export interface EventLog {
  session_id: string;
  event_type: string;
  tool_name?: string;
  server_name: string;
  risk_level?: string;
  action_type?: string;
  target?: string;
  engines_run?: number;
  engines_triggered?: number;
  latency_ms: number;
  outcome: string;
  details?: Record<string, unknown>;
}

// ============================================================================
// Message Interceptor
// ============================================================================

export class MessageInterceptor extends EventEmitter {
  private pendingRequests: Map<string | number, JSONRPCRequest> = new Map();
  private session: SessionState;
  private toolsCache: MCPTool[] = [];

  constructor(
    private config: InterceptorConfig,
    private deps: InterceptorDependencies
  ) {
    super();
    this.session = this.createSession();
  }

  /**
   * Create a new session state
   */
  private createSession(): SessionState {
    return {
      session_id: nanoid(),
      started_at: new Date(),
      tool_call_count: 0,
      session_cost_usd: 0,
      recent_signatures: [],
      error_counts: new Map(),
      call_counts: new Map(),
      latency_history: new Map(),
      call_timestamps: [],
      calls_per_minute: [],
    };
  }

  /**
   * Process an incoming message from the client
   * Returns the message to forward, or null to drop it
   */
  async processClientMessage(line: string): Promise<string | null> {
    const msg = parseMessage(line);
    if (!msg) {
      // Invalid JSON-RPC, pass through anyway
      return line;
    }

    if (isRequest(msg)) {
      return this.handleClientRequest(msg);
    }

    // Pass through other messages
    return line;
  }

  /**
   * Process an incoming message from the server
   * Returns the message to forward, or null to drop it
   */
  async processServerMessage(line: string): Promise<string | null> {
    const msg = parseMessage(line);
    if (!msg) {
      return line;
    }

    if (isResponse(msg)) {
      return this.handleServerResponse(msg);
    }

    // Pass through notifications and other messages
    return line;
  }

  /**
   * Handle a request from the client
   */
  private async handleClientRequest(request: JSONRPCRequest): Promise<string | null> {
    // Store pending request for response matching
    this.pendingRequests.set(request.id, request);

    // Check if this is a tools/call request
    if (request.method === INTERCEPTED_METHODS.TOOLS_CALL) {
      return this.handleToolsCall(request);
    }

    // Pass through other requests
    return serializeMessage(request);
  }

  /**
   * Handle a tools/call request
   */
  private async handleToolsCall(request: JSONRPCRequest): Promise<string | null> {
    const startTime = performance.now();
    const params = request.params as ToolCallParams | undefined;

    if (!params?.name) {
      // Invalid tool call, let server handle it
      return serializeMessage(request);
    }

    const toolName = params.name;
    const toolArgs = params.arguments || {};

    // 1. CET classification
    const effect = this.deps.cet.classify(toolName, toolArgs);

    // 2. Knob gate evaluation
    const knobResult = this.deps.knobGate.evaluate(effect);

    if (knobResult.decision === 'block') {
      const latency = performance.now() - startTime;
      this.logEvent('block', toolName, effect, latency, {
        knob: knobResult.knob,
        reason: knobResult.reason,
      });

      // Return blocked response
      const response = createBlockedResponse(
        request.id,
        'knob_gate',
        'medium',
        knobResult.reason
      );
      return serializeMessage(response);
    }

    if (knobResult.decision === 'approve') {
      // Sprint 1: Use approve_fallback behavior based on preset
      // For now, treat as block for non-YOLO presets
      if (this.config.preset !== 'yolo') {
        const latency = performance.now() - startTime;
        this.logEvent('block', toolName, effect, latency, {
          knob: knobResult.knob,
          reason: 'Action requires approval (approve_fallback: block)',
        });

        const response = createBlockedResponse(
          request.id,
          'knob_gate',
          'medium',
          'Action requires approval'
        );
        return serializeMessage(response);
      }
    }

    // 3. Run detection engines
    const engineResult = await this.deps.engines.evaluate(
      toolName,
      this.config.serverName,
      toolArgs,
      effect,
      this.session
    );

    // Update session
    this.session.tool_call_count++;
    this.updateCallSignature(toolName, toolArgs);

    if (engineResult.blocked) {
      const latency = performance.now() - startTime;
      this.logEvent('block', toolName, effect, latency, {
        engine: engineResult.blocked_by,
        reason: engineResult.block_reason,
        engines_run: engineResult.engines_run,
        engines_triggered: engineResult.engines_triggered,
      });

      // Notify on block
      this.deps.notifications.notify(
        'critical',
        `BLOCKED: ${toolName} - ${engineResult.block_reason}`
      );

      const response = createBlockedResponse(
        request.id,
        engineResult.blocked_by || 'unknown',
        'critical',
        engineResult.block_reason || 'Action blocked by detection engine'
      );
      return serializeMessage(response);
    }

    // 4. Log and forward
    const latency = performance.now() - startTime;
    this.logEvent('allowed', toolName, effect, latency, {
      engines_run: engineResult.engines_run,
      engines_triggered: engineResult.engines_triggered,
    });

    // Notify on medium+ severity alerts
    if (engineResult.engines_triggered > 0) {
      const highest = engineResult.highest_severity;
      if (highest === 'medium' || highest === 'high' || highest === 'critical') {
        this.deps.notifications.notify(
          highest,
          `Alert: ${toolName} - ${engineResult.engines_triggered} engines triggered`
        );
      }
    }

    return serializeMessage(request);
  }

  /**
   * Handle a response from the server
   */
  private async handleServerResponse(response: JSONRPCResponse): Promise<string | null> {
    const request = this.pendingRequests.get(response.id!);
    if (!request) {
      // Unexpected response, pass through
      return serializeMessage(response);
    }

    this.pendingRequests.delete(response.id!);

    // Check if this is a tools/list response
    if (request.method === INTERCEPTED_METHODS.TOOLS_LIST && response.result) {
      return this.handleToolsListResponse(response);
    }

    // Check if this is a tools/call response
    if (request.method === INTERCEPTED_METHODS.TOOLS_CALL) {
      return this.handleToolsCallResponse(request, response);
    }

    // Pass through other responses
    return serializeMessage(response);
  }

  /**
   * Handle tools/list response - apply Schema Quarantine + ATSP + TOFU
   */
  private async handleToolsListResponse(response: JSONRPCResponse): Promise<string | null> {
    const result = response.result as ToolsListResult;
    const tools = result.tools || [];

    // 1. Schema Quarantine
    const scanResult = await this.deps.schemaQuarantine.scan(tools);

    // Log quarantined tools
    for (const tool of scanResult.adversarial) {
      this.deps.eventStore.logEvent({
        session_id: this.session.session_id,
        event_type: 'quarantine',
        tool_name: tool.name,
        server_name: this.config.serverName,
        latency_ms: 0,
        outcome: 'quarantined',
        details: { reason: 'adversarial content detected' },
      });

      this.deps.notifications.notify(
        'critical',
        `QUARANTINED: ${tool.name} contains adversarial content`
      );
    }

    // Use clean + suspicious (suspicious pass with alert)
    const safeTools = [...scanResult.clean, ...scanResult.suspicious];

    // 2. TOFU pinning
    const tofuResult = await this.deps.tofu.pin(this.config.serverName, safeTools);

    // Alert on new or changed tools
    for (const toolName of tofuResult.newTools) {
      this.deps.notifications.notify(
        'high',
        `New tool detected: ${toolName} on ${this.config.serverName}`
      );
    }

    for (const toolName of tofuResult.changedTools) {
      this.deps.notifications.notify(
        'high',
        `Tool schema changed: ${toolName} on ${this.config.serverName}`
      );
    }

    // 3. ATSP schema rewriting
    const rewrittenTools = this.deps.atsp.rewrite(safeTools);

    // Cache tools for reference
    this.toolsCache = rewrittenTools;

    // Return modified response
    const modifiedResponse: JSONRPCResponse = {
      jsonrpc: '2.0',
      id: response.id,
      result: { tools: rewrittenTools },
    };

    return serializeMessage(modifiedResponse);
  }

  /**
   * Handle tools/call response - apply Output Quarantine
   */
  private async handleToolsCallResponse(
    _request: JSONRPCRequest,
    response: JSONRPCResponse
  ): Promise<string | null> {
    // Check for errors (pass through)
    if (response.error) {
      // Track error for error rate engine
      const errorCount = this.session.error_counts.get(this.config.serverName) || 0;
      this.session.error_counts.set(this.config.serverName, errorCount + 1);
      return serializeMessage(response);
    }

    // Output quarantine scan
    const scanResult = await this.deps.outputQuarantine.scan(response.result);

    if (scanResult.adversarial) {
      this.deps.notifications.notify(
        'critical',
        `BLOCKED: Response contains adversarial content`
      );

      // Return sanitized error
      const errorResponse = createBlockedResponse(
        response.id!,
        'output_quarantine',
        'critical',
        scanResult.reason || 'Response contains adversarial content'
      );
      return serializeMessage(errorResponse);
    }

    if (scanResult.suspicious) {
      this.deps.notifications.notify(
        'medium',
        `Alert: Response flagged as suspicious`
      );
    }

    return serializeMessage(response);
  }

  /**
   * Update call signature for loop detection
   */
  private updateCallSignature(toolName: string, params: Record<string, unknown>): void {
    const paramsHash = createHash('sha256')
      .update(JSON.stringify(params))
      .digest('hex')
      .slice(0, 16);

    const signature: ToolCallSignature = {
      tool_name: toolName,
      params_hash: paramsHash,
      timestamp: Date.now(),
    };

    this.session.recent_signatures.push(signature);

    // Keep last 100 signatures
    if (this.session.recent_signatures.length > 100) {
      this.session.recent_signatures.shift();
    }

    // Update call timestamps for rate limiting
    this.session.call_timestamps.push(Date.now());

    // Keep last 5 minutes of timestamps
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
    this.session.call_timestamps = this.session.call_timestamps.filter(
      (t) => t > fiveMinutesAgo
    );
  }

  /**
   * Log an event
   */
  private logEvent(
    outcome: string,
    toolName: string,
    effect: ToolCallEffect,
    latency: number,
    details?: Record<string, unknown>
  ): void {
    this.deps.eventStore.logEvent({
      session_id: this.session.session_id,
      event_type: 'tool_call',
      tool_name: toolName,
      server_name: this.config.serverName,
      risk_level: effect.risk,
      action_type: effect.action,
      target: effect.target,
      engines_run: details?.engines_run as number | undefined,
      engines_triggered: details?.engines_triggered as number | undefined,
      latency_ms: Math.round(latency),
      outcome,
      details,
    });
  }

  /**
   * Get current session state
   */
  getSession(): SessionState {
    return this.session;
  }

  /**
   * Get cached tools list
   */
  getTools(): MCPTool[] {
    return this.toolsCache;
  }
}
