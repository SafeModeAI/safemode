#!/usr/bin/env node
/**
 * Session-Start Hook
 *
 * Executed when a new Safe Mode session starts.
 * Side effects only (logging, notifications).
 *
 * Input: { sessionId, timestamp, serverName }
 * Output: { continue: boolean, message?: string }
 */

const input = JSON.parse(process.argv[2] || '{}');

// Log session start
const timestamp = new Date(input.timestamp).toISOString();
console.error(`[Safe Mode] Session ${input.sessionId} started at ${timestamp}`);
console.error(`[Safe Mode] Server: ${input.serverName}`);

// Continue normally
console.log(JSON.stringify({ continue: true }));
