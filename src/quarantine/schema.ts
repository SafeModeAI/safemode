/**
 * Schema Quarantine
 *
 * Scans MCP tool schemas for adversarial content before they reach the AI.
 * Implements pattern matching for prompt injection attempts.
 */

import { createHash } from 'node:crypto';
import type { MCPTool } from '../proxy/protocol.js';
import type { EventStore } from '../store/index.js';

// ============================================================================
// Types
// ============================================================================

export interface SchemaScanResult {
  clean: MCPTool[];
  suspicious: MCPTool[];
  adversarial: MCPTool[];
}

export interface ToolScanResult {
  result: 'clean' | 'suspicious' | 'adversarial';
  confidence: number;
  matches: string[];
  reason?: string;
}

// ============================================================================
// Adversarial Patterns
// ============================================================================

const ADVERSARIAL_PATTERNS: Array<{ pattern: RegExp; name: string; severity: 'suspicious' | 'adversarial' }> = [
  // Prompt injection attempts
  {
    pattern: /ignore\s+(all\s+)?previous\s+(instructions?|prompts?|context)/i,
    name: 'ignore_previous',
    severity: 'adversarial',
  },
  {
    pattern: /disregard\s+(all\s+)?(prior|previous|above)\s+(instructions?|prompts?)/i,
    name: 'disregard_prior',
    severity: 'adversarial',
  },
  {
    pattern: /forget\s+(everything|all)\s+(you\s+)?(know|learned|were\s+told)/i,
    name: 'forget_all',
    severity: 'adversarial',
  },
  {
    pattern: /you\s+are\s+now\s+(a|an|the)\s+/i,
    name: 'role_reassignment',
    severity: 'adversarial',
  },
  {
    pattern: /act\s+as\s+(if\s+you\s+are|a|an)\s+/i,
    name: 'act_as',
    severity: 'suspicious',
  },
  {
    pattern: /system\s+prompt\s+(override|injection|bypass)/i,
    name: 'system_override',
    severity: 'adversarial',
  },
  {
    pattern: /new\s+system\s+(prompt|instructions?|rules?)/i,
    name: 'new_system',
    severity: 'adversarial',
  },
  {
    pattern: /override\s+(your\s+)?(instructions?|rules?|constraints?)/i,
    name: 'override_rules',
    severity: 'adversarial',
  },
  {
    pattern: /bypass\s+(safety|security|restrictions?|filters?)/i,
    name: 'bypass_safety',
    severity: 'adversarial',
  },
  {
    pattern: /jailbreak/i,
    name: 'jailbreak',
    severity: 'adversarial',
  },
  {
    pattern: /DAN\s+(mode|prompt)/i,
    name: 'dan_mode',
    severity: 'adversarial',
  },
  {
    pattern: /pretend\s+(you\s+)?(don'?t\s+have|have\s+no)\s+(restrictions?|rules?|limits?)/i,
    name: 'pretend_no_rules',
    severity: 'adversarial',
  },

  // Hidden instructions
  {
    pattern: /\[\s*system\s*\]/i,
    name: 'fake_system_tag',
    severity: 'adversarial',
  },
  {
    pattern: /<\s*system\s*>/i,
    name: 'system_xml_tag',
    severity: 'adversarial',
  },
  {
    pattern: /\{\{\s*system\s*\}\}/i,
    name: 'system_template',
    severity: 'adversarial',
  },
  {
    pattern: /IMPORTANT:\s*ignore/i,
    name: 'important_ignore',
    severity: 'adversarial',
  },

  // Encoding attacks
  {
    pattern: /base64\s*:\s*[A-Za-z0-9+\/=]{20,}/i,
    name: 'base64_payload',
    severity: 'suspicious',
  },
  {
    pattern: /\\x[0-9a-f]{2}(\\x[0-9a-f]{2}){5,}/i,
    name: 'hex_escape',
    severity: 'suspicious',
  },
  {
    pattern: /\\u[0-9a-f]{4}(\\u[0-9a-f]{4}){5,}/i,
    name: 'unicode_escape',
    severity: 'suspicious',
  },

  // Dangerous command patterns in descriptions
  {
    pattern: /rm\s+-rf?\s+\/(?:\s|$)/,
    name: 'rm_rf_root',
    severity: 'adversarial',
  },
  {
    pattern: /sudo\s+(rm|chmod|chown|mkfs|dd)/i,
    name: 'sudo_dangerous',
    severity: 'suspicious',
  },
  {
    pattern: /curl\s+.*\|\s*(bash|sh|zsh)/i,
    name: 'curl_pipe_shell',
    severity: 'adversarial',
  },
  {
    pattern: /wget\s+.*\|\s*(bash|sh|zsh)/i,
    name: 'wget_pipe_shell',
    severity: 'adversarial',
  },

  // Social engineering
  {
    pattern: /admin(istrator)?\s+(password|credentials?|secret)/i,
    name: 'admin_creds',
    severity: 'suspicious',
  },
  {
    pattern: /api[_\s]?key[_\s]?:\s*["']?[a-zA-Z0-9_-]{20,}/i,
    name: 'api_key_leak',
    severity: 'suspicious',
  },
];

// Zero-width characters that could hide content
const ZERO_WIDTH_PATTERN = /[\u200B\u200C\u200D\uFEFF\u2060\u2061\u2062\u2063\u2064]/g;

// Unicode homoglyphs (simplified set)
const HOMOGLYPH_PATTERNS = [
  /[аеіоруАЕІОРУ]/g, // Cyrillic lookalikes
  /[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]/g, // Roman numerals
];

// ============================================================================
// Schema Quarantine
// ============================================================================

export class SchemaQuarantine {
  private cache: Map<string, ToolScanResult> = new Map();
  private maxDescLength = 10000;
  private maxToolCount = 500;
  private maxDepth = 10;

  constructor(private store?: EventStore) {}

  /**
   * Scan an array of tools
   */
  async scan(tools: MCPTool[]): Promise<SchemaScanResult> {
    // Enforce limits
    if (tools.length > this.maxToolCount) {
      tools = tools.slice(0, this.maxToolCount);
    }

    const clean: MCPTool[] = [];
    const suspicious: MCPTool[] = [];
    const adversarial: MCPTool[] = [];

    for (const tool of tools) {
      const result = await this.scanTool(tool);

      switch (result.result) {
        case 'clean':
          clean.push(tool);
          break;
        case 'suspicious':
          suspicious.push(tool);
          break;
        case 'adversarial':
          adversarial.push(tool);
          break;
      }
    }

    return { clean, suspicious, adversarial };
  }

  /**
   * Scan a single tool
   */
  async scanTool(tool: MCPTool): Promise<ToolScanResult> {
    // Check cache first
    const hash = this.computeToolHash(tool);
    const cached = this.cache.get(hash);
    if (cached) {
      return cached;
    }

    // Also check persistent cache
    if (this.store) {
      const stored = this.store.getQuarantineCache(hash);
      if (stored) {
        const result: ToolScanResult = {
          result: stored.result as 'clean' | 'suspicious' | 'adversarial',
          confidence: stored.confidence,
          matches: [],
        };
        this.cache.set(hash, result);
        return result;
      }
    }

    // Extract all text content from tool
    const textContent = this.extractTextContent(tool);

    // Scan for patterns
    const matches: string[] = [];
    let hasSuspicious = false;
    let hasAdversarial = false;

    for (const content of textContent) {
      // Check for zero-width characters
      if (ZERO_WIDTH_PATTERN.test(content)) {
        matches.push('zero_width_chars');
        hasSuspicious = true;
      }

      // Check for homoglyphs
      for (const pattern of HOMOGLYPH_PATTERNS) {
        if (pattern.test(content)) {
          matches.push('homoglyphs');
          hasSuspicious = true;
          break;
        }
      }

      // Check adversarial patterns
      for (const { pattern, name, severity } of ADVERSARIAL_PATTERNS) {
        if (pattern.test(content)) {
          matches.push(name);
          if (severity === 'adversarial') {
            hasAdversarial = true;
          } else {
            hasSuspicious = true;
          }
        }
      }
    }

    // Determine result
    let result: 'clean' | 'suspicious' | 'adversarial';
    let confidence: number;

    if (hasAdversarial) {
      result = 'adversarial';
      confidence = 0.95;
    } else if (hasSuspicious) {
      result = 'suspicious';
      confidence = 0.8;
    } else {
      result = 'clean';
      confidence = 1.0;
    }

    const scanResult: ToolScanResult = {
      result,
      confidence,
      matches,
      reason: matches.length > 0 ? `Matched patterns: ${matches.join(', ')}` : undefined,
    };

    // Cache result
    this.cache.set(hash, scanResult);
    if (this.store) {
      this.store.setQuarantineCache(hash, result, confidence);
    }

    return scanResult;
  }

  /**
   * Extract all text content from a tool for scanning
   */
  private extractTextContent(tool: MCPTool, depth: number = 0): string[] {
    if (depth > this.maxDepth) {
      return [];
    }

    const content: string[] = [];

    // Tool name and description
    if (tool.name) {
      content.push(this.truncate(tool.name));
    }
    if (tool.description) {
      content.push(this.truncate(tool.description));
    }

    // Extract from input schema
    if (tool.inputSchema) {
      content.push(...this.extractFromSchema(tool.inputSchema as unknown as Record<string, unknown>, depth + 1));
    }

    return content;
  }

  /**
   * Extract text from JSON schema
   */
  private extractFromSchema(schema: Record<string, unknown>, depth: number): string[] {
    if (depth > this.maxDepth) {
      return [];
    }

    const content: string[] = [];

    // Check string fields
    const stringFields = ['title', 'description', 'default', 'pattern'];
    for (const field of stringFields) {
      if (typeof schema[field] === 'string') {
        content.push(this.truncate(schema[field] as string));
      }
    }

    // Check enum values
    if (Array.isArray(schema.enum)) {
      for (const value of schema.enum) {
        if (typeof value === 'string') {
          content.push(this.truncate(value));
        }
      }
    }

    // Check examples
    if (Array.isArray(schema.examples)) {
      for (const example of schema.examples) {
        if (typeof example === 'string') {
          content.push(this.truncate(example));
        }
      }
    }

    // Recurse into properties
    if (typeof schema.properties === 'object' && schema.properties !== null) {
      for (const prop of Object.values(schema.properties as Record<string, unknown>)) {
        if (typeof prop === 'object' && prop !== null) {
          content.push(...this.extractFromSchema(prop as Record<string, unknown>, depth + 1));
        }
      }
    }

    // Recurse into items (array schema)
    if (typeof schema.items === 'object' && schema.items !== null) {
      content.push(...this.extractFromSchema(schema.items as Record<string, unknown>, depth + 1));
    }

    return content;
  }

  /**
   * Compute hash for caching
   */
  private computeToolHash(tool: MCPTool): string {
    const content = JSON.stringify({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    });

    return createHash('sha256').update(content).digest('hex');
  }

  /**
   * Truncate string to max length
   */
  private truncate(str: string): string {
    return str.length > this.maxDescLength ? str.slice(0, this.maxDescLength) : str;
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
  }
}
