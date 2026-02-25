#!/usr/bin/env node
/**
 * Pre-Tool-Call Hook
 *
 * Executed before a tool call is forwarded to the MCP server.
 * Can block or modify the call.
 *
 * Input: { sessionId, toolName, serverName, parameters, effect }
 * Output: { continue: boolean, modified?: parameters, message?: string }
 */

const input = JSON.parse(process.argv[2] || '{}');

// Example: Block sudo commands
if (input.parameters?.command && typeof input.parameters.command === 'string') {
  if (input.parameters.command.includes('sudo ')) {
    console.log(JSON.stringify({
      continue: false,
      message: 'sudo commands blocked by pre-tool-call hook'
    }));
    process.exit(0);
  }
}

// Example: Sanitize paths - remove path traversal attempts
if (input.parameters?.path && typeof input.parameters.path === 'string') {
  const sanitized = input.parameters.path.replace(/\.\.\/|\.\.\\/, '');
  if (sanitized !== input.parameters.path) {
    console.log(JSON.stringify({
      continue: true,
      modified: { ...input.parameters, path: sanitized },
      message: 'Path sanitized by pre-tool-call hook'
    }));
    process.exit(0);
  }
}

// Continue normally
console.log(JSON.stringify({ continue: true }));
