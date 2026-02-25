#!/usr/bin/env node
/**
 * Session-End Hook
 *
 * Executed when a Safe Mode session ends.
 * Side effects only (reporting, cleanup).
 *
 * Input: { sessionId, timestamp, stats: { toolCalls, blocks, alerts, totalLatencyMs } }
 * Output: { continue: boolean, message?: string }
 */

const input = JSON.parse(process.argv[2] || '{}');

// Generate session summary
const stats = input.stats || {};
const duration = stats.totalLatencyMs ? `${(stats.totalLatencyMs / 1000).toFixed(2)}s` : 'unknown';

console.error('');
console.error('[Safe Mode] Session Summary');
console.error('===========================');
console.error(`Session ID: ${input.sessionId}`);
console.error(`Tool Calls: ${stats.toolCalls || 0}`);
console.error(`Blocked:    ${stats.blocks || 0}`);
console.error(`Alerts:     ${stats.alerts || 0}`);
console.error(`Duration:   ${duration}`);
console.error('');

// Continue normally
console.log(JSON.stringify({ continue: true }));
