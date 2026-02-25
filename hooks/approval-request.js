#!/usr/bin/env node
/**
 * Approval-Request Hook
 *
 * Executed when a tool call requires approval.
 * Can implement custom approval logic.
 *
 * Input: { sessionId, toolName, serverName, effect, reason, engineName }
 * Output: { continue: boolean, approved?: boolean, message?: string }
 */

const input = JSON.parse(process.argv[2] || '{}');

// Log approval request
console.error('');
console.error('[Safe Mode] Approval Required');
console.error('=============================');
console.error(`Tool:     ${input.toolName}`);
console.error(`Server:   ${input.serverName}`);
console.error(`Risk:     ${input.effect?.risk || 'unknown'}`);
console.error(`Reason:   ${input.reason || 'No reason provided'}`);
console.error(`Engine:   ${input.engineName || 'N/A'}`);
console.error('');

// By default, defer to Safe Mode's approval system
// Custom implementations could:
// - Prompt the user via terminal
// - Send a notification and wait
// - Check against an external policy server
// - Auto-approve based on custom rules

// Example: Auto-approve low risk operations
if (input.effect?.risk === 'low') {
  console.log(JSON.stringify({
    continue: true,
    approved: true,
    message: 'Auto-approved low-risk operation'
  }));
  process.exit(0);
}

// Defer to default behavior
console.log(JSON.stringify({ continue: true }));
