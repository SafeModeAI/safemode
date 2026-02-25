/**
 * Engine 12: Jailbreak Detector
 *
 * Detects jailbreak attempts in tool parameters using ML model
 * or regex fallback. Uses meta-llama/Prompt-Guard-2-22M when available.
 *
 * Detection includes:
 * - DAN (Do Anything Now) variants
 * - Unrestricted mode requests
 * - Safety bypass attempts
 * - Content filter circumvention
 */

import type { DetectionEngine, EngineContext, EngineResult } from './base.js';
import { createNoDetectionResult, createDetectionResult } from './base.js';
import { PromptGuardInference, getInference } from '../ml/inference.js';
import { getModelManager } from '../ml/model-manager.js';

// ============================================================================
// Engine
// ============================================================================

export class JailbreakEngine implements DetectionEngine {
  readonly id = 12;
  readonly name = 'jailbreak_detector';
  readonly description = 'Detects jailbreak attempts in tool parameters';

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
   * Evaluate for jailbreak attempts
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

    if (!result.isJailbreak) {
      return createNoDetectionResult(this.id, this.name, latency);
    }

    // Determine severity based on confidence
    let severity: 'low' | 'medium' | 'high' | 'critical' = 'high';
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
      'block', // Jailbreak attempts are always blocked
      result.riskScore,
      {
        detection_method: 'ml',
        model: 'prompt-guard-2-22m',
        scores: result.scores,
        label: result.label,
        reason: 'Jailbreak attempt detected',
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

    // Critical patterns - definite jailbreak attempts
    const criticalPatterns: Array<[RegExp, string]> = [
      [/\bDAN\b.*\bdo\s+anything\s+now\b/i, 'DAN jailbreak'],
      [/\bdo\s+anything\s+now\b/i, 'do anything now'],
      [/\bjailbreak(ed|ing)?\s+(mode|prompt)/i, 'jailbreak mode'],
      [/\bunleash(ed)?\s+mode/i, 'unleashed mode'],
      [/\bgodmode\b/i, 'godmode'],
      [/\bdevmode\b/i, 'developer mode'],
      [/\bunrestricted\s+ai/i, 'unrestricted AI'],
      [/\bno\s+rules?\s+mode/i, 'no rules mode'],
    ];

    // High patterns
    const highPatterns: Array<[RegExp, string]> = [
      [/\b(disable|remove|bypass)\s+(all\s+)?(safety|restrictions?|filters?|guidelines?)/i, 'safety bypass'],
      [/\b(ignore|disregard)\s+(all\s+)?(safety|ethical|moral)/i, 'ignore safety'],
      [/\bwithout\s+(any\s+)?(restrictions?|limits?|guidelines?)/i, 'without restrictions'],
      [/\bno\s+(ethical|moral|safety)\s+(guidelines?|restrictions?)/i, 'no ethical guidelines'],
      [/\beverything\s+is\s+(allowed|permitted)/i, 'everything allowed'],
      [/\byou\s+have\s+no\s+(rules?|restrictions?|limits?)/i, 'no rules'],
      [/\bact\s+without\s+(any\s+)?(restrictions?|limits?)/i, 'act without restrictions'],
      [/\bno\s+content\s+(policy|filter)/i, 'no content policy'],
      [/\bbypass\s+content\s+(policy|filter)/i, 'bypass content policy'],
      [/\bdisable\s+content\s+(moderation|filter)/i, 'disable content moderation'],
    ];

    // Medium patterns - potentially jailbreak-related
    const mediumPatterns: Array<[RegExp, string]> = [
      [/\bunfiltered\s+(mode|response|output)/i, 'unfiltered mode'],
      [/\braw\s+mode/i, 'raw mode'],
      [/\buncensored\b/i, 'uncensored'],
      [/\bno\s+censorship/i, 'no censorship'],
      [/\bbreak(ing)?\s+(free|out)/i, 'breaking free'],
      [/\bunchain(ed)?\b/i, 'unchained'],
      [/\bunlocked\s+(mode|version)/i, 'unlocked mode'],
      [/\bhypothetically,?\s+if\s+you\s+(had|were|could)/i, 'hypothetical bypass'],
      [/\bin\s+a\s+fictional\s+world\s+where/i, 'fictional world bypass'],
    ];

    // Known jailbreak names/variants
    const jailbreakNames = [
      'DAN', 'STAN', 'DUDE', 'Mongo Tom', 'Evil Confidant',
      'Maximum', 'KEVIN', 'AIM', 'UCAR', 'JailBreak',
      'Developer Mode', 'Opposite Mode', 'ANTI-DAN',
      'BasedGPT', 'AntiGPT', 'UnGPT', 'FreeGPT',
    ];

    // Check for known jailbreak names
    for (const name of jailbreakNames) {
      const regex = new RegExp(`\\b${name.replace(/\s+/g, '\\s+')}\\b`, 'i');
      if (regex.test(text)) {
        findings.push({
          pattern: `jailbreak variant: ${name}`,
          severity: 'critical',
          match: name,
        });
      }
    }

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
    const confidence = Math.min(0.6 + findings.length * 0.15, 0.98);

    return createDetectionResult(
      this.id,
      this.name,
      highestSeverity,
      'block', // Jailbreak attempts are always blocked
      confidence,
      {
        detection_method: 'regex',
        findings,
        patterns_matched: findings.length,
        reason: `Jailbreak attempt detected: ${findings[0]?.pattern ?? 'unknown pattern'}`,
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
