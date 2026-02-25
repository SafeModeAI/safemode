/**
 * Engine 11: Prompt Injection Detector
 *
 * Detects prompt injection attacks in tool parameters using ML model
 * or regex fallback. Uses meta-llama/Prompt-Guard-2-22M when available.
 *
 * Detection includes:
 * - "Ignore previous instructions" patterns
 * - Role reassignment attempts
 * - System prompt overrides
 * - Instruction hijacking
 */

import type { DetectionEngine, EngineContext, EngineResult } from './base.js';
import { createNoDetectionResult, createDetectionResult } from './base.js';
import { PromptGuardInference, getInference } from '../ml/inference.js';
import { getModelManager } from '../ml/model-manager.js';

// ============================================================================
// Engine
// ============================================================================

export class PromptInjectionEngine implements DetectionEngine {
  readonly id = 11;
  readonly name = 'prompt_injection';
  readonly description = 'Detects prompt injection attacks in tool parameters';

  private inference: PromptGuardInference | null = null;
  private initialized = false;
  private useML = false;

  /**
   * Initialize the engine
   */
  private async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    // Check if ML model is available
    const modelManager = getModelManager();
    const isDownloaded = modelManager.isModelDownloaded('prompt-guard');

    if (isDownloaded) {
      const modelPath = modelManager.getModelPath('prompt-guard');
      this.inference = getInference(modelPath);

      // Try to load the model
      const loaded = await this.inference.load();
      this.useML = loaded;
    }
  }

  /**
   * Evaluate for prompt injection
   */
  async evaluate(context: EngineContext): Promise<EngineResult> {
    const startTime = performance.now();

    await this.initialize();

    // Extract all text content from parameters
    const text = this.extractText(context.parameters);

    if (!text || text.length === 0) {
      return createNoDetectionResult(this.id, this.name, performance.now() - startTime);
    }

    // Run ML detection if available
    if (this.useML && this.inference) {
      return this.evaluateML(text, startTime);
    }

    // Fall back to regex detection
    return this.evaluateRegex(text, startTime);
  }

  /**
   * ML-based evaluation
   */
  private async evaluateML(text: string, startTime: number): Promise<EngineResult> {
    const result = await this.inference!.infer(text);
    const latency = performance.now() - startTime;

    if (!result.isInjection) {
      return createNoDetectionResult(this.id, this.name, latency);
    }

    // Determine severity based on confidence
    let severity: 'low' | 'medium' | 'high' | 'critical' = 'medium';
    if (result.riskScore > 0.9) {
      severity = 'critical';
    } else if (result.riskScore > 0.7) {
      severity = 'high';
    } else if (result.riskScore > 0.5) {
      severity = 'medium';
    }

    return createDetectionResult(
      this.id,
      this.name,
      severity,
      severity === 'critical' ? 'block' : 'alert',
      result.riskScore,
      {
        detection_method: 'ml',
        model: 'prompt-guard-2-22m',
        scores: result.scores,
        label: result.label,
        reason: 'Prompt injection pattern detected',
      },
      latency
    );
  }

  /**
   * Regex-based evaluation
   */
  private evaluateRegex(text: string, startTime: number): EngineResult {
    const findings: Array<{
      pattern: string;
      severity: 'medium' | 'high' | 'critical';
      match: string;
    }> = [];

    // Critical patterns - immediate block
    const criticalPatterns: Array<[RegExp, string]> = [
      [/ignore\s+all\s+previous\s+instructions/i, 'ignore all previous instructions'],
      [/disregard\s+everything\s+(before|above)/i, 'disregard everything'],
      [/new\s+system\s+prompt\s*:/i, 'new system prompt'],
      [/\[SYSTEM\]\s*:/i, 'system tag injection'],
      [/<\|system\|>/i, 'system delimiter injection'],
    ];

    // High patterns
    const highPatterns: Array<[RegExp, string]> = [
      [/ignore\s+(previous|prior|above)\s+instructions?/i, 'ignore instructions'],
      [/disregard\s+(previous|prior|above)\s+instructions?/i, 'disregard instructions'],
      [/forget\s+(everything|all|previous)/i, 'forget instructions'],
      [/you\s+are\s+now\s+(a|an|the)/i, 'role reassignment'],
      [/act\s+as\s+if\s+you\s+(are|were)/i, 'role manipulation'],
      [/pretend\s+(you\s+are|to\s+be|that)/i, 'pretend directive'],
      [/from\s+now\s+on,?\s+you/i, 'behavioral override'],
      [/override\s+(your|the|all)\s+(instructions|rules|guidelines)/i, 'instruction override'],
    ];

    // Medium patterns
    const mediumPatterns: Array<[RegExp, string]> = [
      [/roleplay\s+as/i, 'roleplay directive'],
      [/simulate\s+(being|a|an)/i, 'simulation directive'],
      [/respond\s+as\s+(if|though)/i, 'response manipulation'],
      [/\bsystem\s*:\s*\w/i, 'system prefix'],
      [/\bassistant\s*:\s*\w/i, 'assistant prefix'],
      [/\buser\s*:\s*\w/i, 'user prefix'],
    ];

    // Check critical patterns
    for (const [pattern, name] of criticalPatterns) {
      const match = text.match(pattern);
      if (match) {
        findings.push({
          pattern: name,
          severity: 'critical',
          match: match[0],
        });
      }
    }

    // Check high patterns
    for (const [pattern, name] of highPatterns) {
      const match = text.match(pattern);
      if (match) {
        findings.push({
          pattern: name,
          severity: 'high',
          match: match[0],
        });
      }
    }

    // Check medium patterns
    for (const [pattern, name] of mediumPatterns) {
      const match = text.match(pattern);
      if (match) {
        findings.push({
          pattern: name,
          severity: 'medium',
          match: match[0],
        });
      }
    }

    const latency = performance.now() - startTime;

    if (findings.length === 0) {
      return createNoDetectionResult(this.id, this.name, latency);
    }

    // Determine highest severity
    const severityOrder = { medium: 0, high: 1, critical: 2 } as const;
    let highestSeverity: 'medium' | 'high' | 'critical' = 'medium';
    for (const finding of findings) {
      if (severityOrder[finding.severity] > severityOrder[highestSeverity]) {
        highestSeverity = finding.severity;
      }
    }

    // Calculate confidence based on number of patterns matched
    const confidence = Math.min(0.5 + findings.length * 0.15, 0.95);

    return createDetectionResult(
      this.id,
      this.name,
      highestSeverity,
      highestSeverity === 'critical' ? 'block' : 'alert',
      confidence,
      {
        detection_method: 'regex',
        findings,
        patterns_matched: findings.length,
        reason: `Prompt injection detected: ${findings[0]?.pattern ?? 'unknown pattern'}`,
      },
      latency
    );
  }

  /**
   * Extract all text content from parameters
   */
  private extractText(params: Record<string, unknown>): string {
    const texts: string[] = [];

    const extract = (value: unknown): void => {
      if (typeof value === 'string') {
        texts.push(value);
      } else if (Array.isArray(value)) {
        value.forEach(extract);
      } else if (value && typeof value === 'object') {
        Object.values(value).forEach(extract);
      }
    };

    extract(params);
    return texts.join(' ');
  }
}
