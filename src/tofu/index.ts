/**
 * TOFU (Trust On First Use)
 *
 * Pins tool schemas on first encounter and alerts on changes.
 * Helps detect supply chain attacks and unexpected tool modifications.
 */

import { createHash } from 'node:crypto';
import type { MCPTool } from '../proxy/protocol.js';
import type { EventStore, SchemaPinRecord } from '../store/index.js';

// ============================================================================
// Types
// ============================================================================

export interface TOFUResult {
  newTools: string[];
  changedTools: string[];
  removedTools: string[];
}

export interface TOFUPinRecord {
  toolName: string;
  schemaHash: string;
  firstSeen: Date;
  lastSeen: Date;
}

// ============================================================================
// TOFU Manager
// ============================================================================

export class TOFUManager {
  constructor(private store: EventStore) {}

  /**
   * Pin tools for a server
   * Returns information about new, changed, and removed tools
   */
  async pin(serverName: string, tools: MCPTool[]): Promise<TOFUResult> {
    const newTools: string[] = [];
    const changedTools: string[] = [];
    const removedTools: string[] = [];

    // Get existing pins for this server
    const existingPins = this.store.getServerPins(serverName);
    const existingPinMap = new Map<string, SchemaPinRecord>();
    for (const pin of existingPins) {
      existingPinMap.set(pin.tool_name, pin);
    }

    // Track seen tools
    const seenTools = new Set<string>();

    // Process each tool
    for (const tool of tools) {
      seenTools.add(tool.name);
      const hash = this.computeSchemaHash(tool);
      const existingPin = existingPinMap.get(tool.name);

      if (!existingPin) {
        // New tool
        newTools.push(tool.name);
        this.store.upsertSchemaPin(serverName, tool.name, hash);
      } else if (existingPin.schema_hash !== hash) {
        // Schema changed
        changedTools.push(tool.name);
        this.store.upsertSchemaPin(serverName, tool.name, hash);
      } else {
        // No change, just update last_seen
        this.store.upsertSchemaPin(serverName, tool.name, hash);
      }
    }

    // Find removed tools
    for (const [toolName] of existingPinMap) {
      if (!seenTools.has(toolName)) {
        removedTools.push(toolName);
        // Optionally delete the pin
        // this.store.deleteSchemaPin(serverName, toolName);
      }
    }

    return { newTools, changedTools, removedTools };
  }

  /**
   * Check if a server has been pinned before
   */
  isServerPinned(serverName: string): boolean {
    const pins = this.store.getServerPins(serverName);
    return pins.length > 0;
  }

  /**
   * Get all pinned tools for a server
   */
  getServerPins(serverName: string): TOFUPinRecord[] {
    const pins = this.store.getServerPins(serverName);
    return pins.map((pin) => ({
      toolName: pin.tool_name,
      schemaHash: pin.schema_hash,
      firstSeen: new Date(pin.first_seen),
      lastSeen: new Date(pin.last_seen),
    }));
  }

  /**
   * Check a single tool against existing pin
   */
  checkTool(
    serverName: string,
    tool: MCPTool
  ): { status: 'new' | 'unchanged' | 'changed'; previousHash?: string } {
    const existingPin = this.store.getSchemaPin(serverName, tool.name);
    const currentHash = this.computeSchemaHash(tool);

    if (!existingPin) {
      return { status: 'new' };
    }

    if (existingPin.schema_hash !== currentHash) {
      return { status: 'changed', previousHash: existingPin.schema_hash };
    }

    return { status: 'unchanged' };
  }

  /**
   * Reset pins for a server
   */
  resetServer(serverName: string): void {
    const pins = this.store.getServerPins(serverName);
    for (const pin of pins) {
      this.store.deleteSchemaPin(serverName, pin.tool_name);
    }
  }

  /**
   * Compute schema hash for a tool
   */
  private computeSchemaHash(tool: MCPTool): string {
    // Hash the full tool definition for accurate change detection
    const content = JSON.stringify({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    });

    return createHash('sha256').update(content).digest('hex');
  }
}
