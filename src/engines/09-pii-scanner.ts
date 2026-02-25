/**
 * Engine 9: PII Scanner
 *
 * Scans tool parameters for personally identifiable information.
 * SSN, Credit Cards (Luhn), Email, Phone, Address, Passport
 * Alert only (does not block)
 */

import type { DetectionEngine, EngineResult, EngineContext } from './base.js';

// ============================================================================
// PII Patterns
// ============================================================================

const PII_PATTERNS: Array<{
  name: string;
  pattern: RegExp;
  validate?: (match: string) => boolean;
}> = [
  // Social Security Number (US)
  {
    name: 'ssn',
    pattern: /\b\d{3}[-.\s]?\d{2}[-.\s]?\d{4}\b/g,
    validate: (match) => {
      const digits = match.replace(/\D/g, '');
      // Basic SSN validation
      if (digits.length !== 9) return false;
      if (digits.startsWith('000')) return false;
      if (digits.startsWith('666')) return false;
      if (digits.startsWith('9')) return false;
      if (digits.slice(3, 5) === '00') return false;
      if (digits.slice(5) === '0000') return false;
      return true;
    },
  },

  // Credit Card Numbers (with Luhn validation)
  {
    name: 'credit_card',
    pattern: /\b(?:\d{4}[-.\s]?){3}\d{4}\b|\b\d{13,19}\b/g,
    validate: (match) => {
      const digits = match.replace(/\D/g, '');
      if (digits.length < 13 || digits.length > 19) return false;
      return luhnCheck(digits);
    },
  },

  // Email addresses
  {
    name: 'email',
    pattern: /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/gi,
  },

  // Phone numbers (various formats)
  {
    name: 'phone',
    pattern: /\b(?:\+?1[-.\s]?)?\(?[0-9]{3}\)?[-.\s]?[0-9]{3}[-.\s]?[0-9]{4}\b/g,
  },

  // US Street Addresses (simplified)
  {
    name: 'address',
    pattern:
      /\b\d{1,5}\s+(?:[A-Za-z]+\s+){1,4}(?:Street|St|Avenue|Ave|Boulevard|Blvd|Road|Rd|Drive|Dr|Lane|Ln|Court|Ct|Way|Place|Pl)\b/gi,
  },

  // Passport numbers (simplified - various countries)
  {
    name: 'passport',
    pattern: /\b[A-Z]{1,2}\d{6,9}\b/g,
  },

  // Date of Birth patterns
  {
    name: 'dob',
    pattern: /\b(?:0?[1-9]|1[0-2])[-/.](?:0?[1-9]|[12]\d|3[01])[-/.](?:19|20)\d{2}\b/g,
  },
];

/**
 * Luhn algorithm for credit card validation
 */
function luhnCheck(digits: string): boolean {
  let sum = 0;
  let isEven = false;

  for (let i = digits.length - 1; i >= 0; i--) {
    const char = digits[i];
    if (!char) continue;
    let digit = parseInt(char, 10);

    if (isEven) {
      digit *= 2;
      if (digit > 9) {
        digit -= 9;
      }
    }

    sum += digit;
    isEven = !isEven;
  }

  return sum % 10 === 0;
}

// ============================================================================
// PII Scanner Engine
// ============================================================================

export class PIIScanner implements DetectionEngine {
  readonly id = 9;
  readonly name = 'pii_scanner';
  readonly description = 'Scans for personally identifiable information';

  async evaluate(context: EngineContext): Promise<EngineResult> {
    const { parameters } = context;

    // Convert parameters to string for scanning
    const content = JSON.stringify(parameters);

    const findings: Array<{ type: string; count: number }> = [];

    for (const { name, pattern, validate } of PII_PATTERNS) {
      // Reset regex state
      pattern.lastIndex = 0;

      const matches = content.match(pattern) || [];
      let validMatches: string[] = [...matches];

      if (validate) {
        validMatches = validMatches.filter((m): m is string => m !== undefined && validate(m));
      }

      if (validMatches.length > 0) {
        findings.push({ type: name, count: validMatches.length });
      }
    }

    if (findings.length > 0) {
      const summary = findings.map((f) => `${f.count} ${f.type}`).join(', ');

      return {
        engine_id: this.id,
        engine_name: this.name,
        detected: true,
        severity: 'medium',
        confidence: 0.85,
        action: 'alert', // PII is alert-only, not block
        details: {
          reason: `PII detected: ${summary}`,
          findings,
          total_findings: findings.reduce((sum, f) => sum + f.count, 0),
        },
        latency_ms: 0,
      };
    }

    return {
      engine_id: this.id,
      engine_name: this.name,
      detected: false,
      severity: 'info',
      confidence: 1.0,
      action: 'allow',
      details: {},
      latency_ms: 0,
    };
  }
}
