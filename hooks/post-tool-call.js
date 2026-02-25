#!/usr/bin/env node
/**
 * Post-Tool-Call Hook
 *
 * Executed after a tool call returns from the MCP server.
 * Can modify the response before it's returned to the client.
 *
 * Input: { sessionId, toolName, serverName, parameters, result, latencyMs }
 * Output: { continue: boolean, modified?: result, message?: string }
 */

const input = JSON.parse(process.argv[2] || '{}');

// Helper to redact sensitive patterns
function redactSensitive(text) {
  if (typeof text !== 'string') return text;

  // Redact AWS keys
  text = text.replace(/AKIA[0-9A-Z]{16}/g, 'AKIA[REDACTED]');

  // Redact GitHub tokens
  text = text.replace(/ghp_[A-Za-z0-9]{36}/g, 'ghp_[REDACTED]');

  // Redact credit card numbers (basic pattern)
  text = text.replace(/\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b/g, '[CARD REDACTED]');

  // Redact SSN
  text = text.replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[SSN REDACTED]');

  return text;
}

if (input.result && typeof input.result === 'object') {
  const result = input.result;

  // Handle text content
  if (result.content && typeof result.content === 'string') {
    const redacted = redactSensitive(result.content);
    if (redacted !== result.content) {
      console.log(JSON.stringify({
        continue: true,
        modified: { ...result, content: redacted },
        message: 'Sensitive data redacted from output'
      }));
      process.exit(0);
    }
  }

  // Handle array content
  if (Array.isArray(result.content)) {
    let modified = false;
    const newContent = result.content.map(item => {
      if (item.type === 'text' && typeof item.text === 'string') {
        const redacted = redactSensitive(item.text);
        if (redacted !== item.text) {
          modified = true;
          return { ...item, text: redacted };
        }
      }
      return item;
    });

    if (modified) {
      console.log(JSON.stringify({
        continue: true,
        modified: { ...result, content: newContent },
        message: 'Sensitive data redacted from output'
      }));
      process.exit(0);
    }
  }
}

// Continue normally
console.log(JSON.stringify({ continue: true }));
