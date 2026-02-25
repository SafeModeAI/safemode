#!/usr/bin/env node
/**
 * On-Error Hook
 *
 * Executed when an error occurs during Safe Mode processing.
 * Side effects only (logging, notifications).
 *
 * Input: { sessionId, error: { message, stack, code }, context: { toolName, serverName, phase } }
 * Output: { continue: boolean, message?: string }
 */

const input = JSON.parse(process.argv[2] || '{}');

// Log error details
console.error('');
console.error('[Safe Mode] Error Occurred');
console.error('==========================');
console.error(`Session:  ${input.sessionId}`);
console.error(`Phase:    ${input.context?.phase || 'unknown'}`);
console.error(`Tool:     ${input.context?.toolName || 'N/A'}`);
console.error(`Server:   ${input.context?.serverName || 'N/A'}`);
console.error(`Error:    ${input.error?.message || 'Unknown error'}`);

if (input.error?.stack) {
  console.error('');
  console.error('Stack trace:');
  console.error(input.error.stack);
}

console.error('');

// Continue normally (errors are already handled by Safe Mode)
console.log(JSON.stringify({ continue: true }));
