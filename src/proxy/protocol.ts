/**
 * MCP Protocol Types
 *
 * JSON-RPC 2.0 protocol types for Model Context Protocol.
 * MCP uses newline-delimited JSON over stdio.
 */

// ============================================================================
// JSON-RPC 2.0 Base Types
// ============================================================================

export interface JSONRPCRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

export interface JSONRPCNotification {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown>;
}

export interface JSONRPCResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: JSONRPCError;
}

export interface JSONRPCError {
  code: number;
  message: string;
  data?: unknown;
}

export type JSONRPCMessage = JSONRPCRequest | JSONRPCNotification | JSONRPCResponse;

// ============================================================================
// MCP Tool Types
// ============================================================================

export interface MCPTool {
  name: string;
  description?: string;
  inputSchema: MCPToolInputSchema;
}

export interface MCPToolInputSchema {
  type: 'object';
  properties?: Record<string, MCPToolProperty>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface MCPToolProperty {
  type: string;
  description?: string;
  title?: string;
  enum?: string[];
  pattern?: string;
  default?: unknown;
  examples?: unknown[];
  items?: MCPToolProperty;
  properties?: Record<string, MCPToolProperty>;
  required?: string[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
}

// ============================================================================
// MCP Method Types
// ============================================================================

export interface ToolsListResult {
  tools: MCPTool[];
}

export interface ToolCallParams {
  name: string;
  arguments?: Record<string, unknown>;
}

export interface ToolCallResult {
  content: ToolCallContent[];
  isError?: boolean;
}

export interface ToolCallContent {
  type: 'text' | 'image' | 'resource';
  text?: string;
  data?: string;
  mimeType?: string;
  uri?: string;
}

// ============================================================================
// Safe Mode Error Codes
// ============================================================================

export const SAFEMODE_ERROR_CODE = -32001;

export interface SafeModeErrorData {
  engine?: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  reason: string;
  safemode: true;
  details?: Record<string, unknown>;
}

/**
 * Create a Safe Mode error response for blocked actions
 */
export function createBlockedResponse(
  id: string | number,
  engine: string,
  severity: SafeModeErrorData['severity'],
  reason: string,
  details?: Record<string, unknown>
): JSONRPCResponse {
  return {
    jsonrpc: '2.0',
    id,
    error: {
      code: SAFEMODE_ERROR_CODE,
      message: `Safe Mode: Action blocked by ${engine}`,
      data: {
        engine,
        severity,
        reason,
        safemode: true,
        details,
      } satisfies SafeModeErrorData,
    },
  };
}

// ============================================================================
// MCP Methods We Intercept
// ============================================================================

export const INTERCEPTED_METHODS = {
  // Response interception (server → client)
  TOOLS_LIST: 'tools/list',

  // Request interception (client → server)
  TOOLS_CALL: 'tools/call',
} as const;

export const PASSTHROUGH_METHODS = [
  'initialize',
  'initialized',
  'ping',
  'resources/list',
  'resources/read',
  'resources/subscribe',
  'resources/unsubscribe',
  'prompts/list',
  'prompts/get',
  'logging/setLevel',
  'sampling/createMessage',
  'completion/complete',
] as const;

/**
 * Check if a message is a request (has id and method)
 */
export function isRequest(msg: JSONRPCMessage): msg is JSONRPCRequest {
  return 'method' in msg && 'id' in msg && msg.id !== undefined;
}

/**
 * Check if a message is a notification (has method but no id)
 */
export function isNotification(msg: JSONRPCMessage): msg is JSONRPCNotification {
  return 'method' in msg && !('id' in msg);
}

/**
 * Check if a message is a response (has id but no method)
 */
export function isResponse(msg: JSONRPCMessage): msg is JSONRPCResponse {
  return 'id' in msg && !('method' in msg);
}

/**
 * Check if a response is an error
 */
export function isErrorResponse(msg: JSONRPCResponse): boolean {
  return 'error' in msg && msg.error !== undefined;
}

/**
 * Parse a JSON-RPC message from a line of text
 */
export function parseMessage(line: string): JSONRPCMessage | null {
  try {
    const parsed = JSON.parse(line.trim());
    if (typeof parsed === 'object' && parsed !== null && parsed.jsonrpc === '2.0') {
      return parsed as JSONRPCMessage;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Serialize a JSON-RPC message to a line of text
 */
export function serializeMessage(msg: JSONRPCMessage): string {
  return JSON.stringify(msg);
}
