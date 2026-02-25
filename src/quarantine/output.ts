/**
 * Output Quarantine
 *
 * Scans MCP tool responses for adversarial content before they reach the AI.
 * Uses the same pattern detection as Schema Quarantine.
 */

import type { EventStore } from '../store/index.js';

// ============================================================================
// Types
// ============================================================================

export interface OutputScanResult {
  clean: boolean;
  suspicious: boolean;
  adversarial: boolean;
  reason?: string;
  matches: string[];
}

// ============================================================================
// Adversarial Patterns (shared with schema quarantine)
// ============================================================================

const ADVERSARIAL_PATTERNS: Array<{
  pattern: RegExp;
  name: string;
  severity: 'suspicious' | 'adversarial';
}> = [
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
    pattern: /you\s+are\s+now\s+(a|an|the)\s+/i,
    name: 'role_reassignment',
    severity: 'adversarial',
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
    pattern: /IMPORTANT:\s*ignore/i,
    name: 'important_ignore',
    severity: 'adversarial',
  },

  // Dangerous commands
  {
    pattern: /rm\s+-rf?\s+\/(?:\s|$)/,
    name: 'rm_rf_root',
    severity: 'adversarial',
  },
  {
    pattern: /curl\s+.*\|\s*(bash|sh|zsh)/i,
    name: 'curl_pipe_shell',
    severity: 'adversarial',
  },
];

// Zero-width characters
const ZERO_WIDTH_PATTERN = /[\u200B\u200C\u200D\uFEFF\u2060\u2061\u2062\u2063\u2064]/g;

// Max response size (5MB)
const MAX_RESPONSE_SIZE = 5 * 1024 * 1024;

// ============================================================================
// Output Quarantine
// ============================================================================

export class OutputQuarantine {
  constructor(_store?: EventStore) {}

  /**
   * Scan a tool response
   */
  async scan(response: unknown): Promise<OutputScanResult> {
    const matches: string[] = [];
    let hasSuspicious = false;
    let hasAdversarial = false;

    // Convert response to string for scanning
    let content: string;
    try {
      content = this.extractContent(response);
    } catch (error) {
      // If we can't extract content, treat as suspicious
      return {
        clean: false,
        suspicious: true,
        adversarial: false,
        reason: 'Failed to extract response content',
        matches: ['extraction_error'],
      };
    }

    // Check size limit
    if (content.length > MAX_RESPONSE_SIZE) {
      return {
        clean: false,
        suspicious: false,
        adversarial: true,
        reason: `Response exceeds maximum size (${MAX_RESPONSE_SIZE} bytes)`,
        matches: ['size_exceeded'],
      };
    }

    // Check for zero-width characters
    if (ZERO_WIDTH_PATTERN.test(content)) {
      matches.push('zero_width_chars');
      hasSuspicious = true;
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

    return {
      clean: !hasSuspicious && !hasAdversarial,
      suspicious: hasSuspicious,
      adversarial: hasAdversarial,
      reason: matches.length > 0 ? `Matched patterns: ${matches.join(', ')}` : undefined,
      matches,
    };
  }

  /**
   * Extract text content from response
   */
  private extractContent(response: unknown): string {
    if (typeof response === 'string') {
      return response;
    }

    if (response === null || response === undefined) {
      return '';
    }

    if (typeof response === 'object') {
      // Handle MCP content array format
      if (Array.isArray(response)) {
        return response.map((item) => this.extractContent(item)).join('\n');
      }

      // Handle content object
      const obj = response as Record<string, unknown>;
      if ('text' in obj && typeof obj.text === 'string') {
        return obj.text;
      }
      if ('content' in obj) {
        return this.extractContent(obj.content);
      }

      // Fall back to JSON stringification
      return JSON.stringify(response);
    }

    return String(response);
  }
}
