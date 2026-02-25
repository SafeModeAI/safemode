#!/usr/bin/env node
/**
 * Schema-Load Hook
 *
 * Executed when tool schemas are loaded from an MCP server.
 * Can filter or modify tool definitions.
 *
 * Input: { sessionId, serverName, tools: ToolSchema[] }
 * Output: { continue: boolean, modified?: tools, message?: string }
 */

const input = JSON.parse(process.argv[2] || '{}');

// Example: Filter out dangerous-sounding tools
const dangerousPatterns = [
  /^delete_all/i,
  /^drop_/i,
  /^destroy_/i,
  /^nuke_/i,
  /^wipe_/i,
];

if (Array.isArray(input.tools)) {
  const filtered = input.tools.filter(tool => {
    for (const pattern of dangerousPatterns) {
      if (pattern.test(tool.name)) {
        console.error(`[Safe Mode Hook] Filtering out dangerous tool: ${tool.name}`);
        return false;
      }
    }
    return true;
  });

  if (filtered.length !== input.tools.length) {
    console.log(JSON.stringify({
      continue: true,
      modified: filtered,
      message: `Filtered ${input.tools.length - filtered.length} dangerous tools`
    }));
    process.exit(0);
  }
}

// Continue normally
console.log(JSON.stringify({ continue: true }));
