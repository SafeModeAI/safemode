/**
 * ONNX Runtime Inference
 *
 * Handles loading and running ONNX models for prompt injection
 * and jailbreak detection.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { PromptGuardTokenizer, SimpleTokenizer } from './tokenizer.js';

// ============================================================================
// Types
// ============================================================================

export interface InferenceResult {
  /** Label: 0 = benign, 1 = injection, 2 = jailbreak */
  label: number;

  /** Confidence scores for each class */
  scores: number[];

  /** Whether injection was detected */
  isInjection: boolean;

  /** Whether jailbreak was detected */
  isJailbreak: boolean;

  /** Overall risk score (0-1) */
  riskScore: number;

  /** Inference latency in ms */
  latencyMs: number;
}

export interface ModelSession {
  run(inputs: Record<string, unknown>): Promise<Record<string, unknown>>;
  release(): Promise<void>;
}

// ============================================================================
// ONNX Runtime Loader
// ============================================================================

type InferenceSessionType = {
  create(path: string, options?: Record<string, unknown>): Promise<ModelSession>;
};

type TensorType = new (
  type: string,
  data: BigInt64Array | Float32Array,
  dims: number[]
) => unknown;

let _onnxRuntime: {
  InferenceSession: InferenceSessionType;
  Tensor: TensorType;
} | null = null;
let _onnxLoadAttempted = false;

/**
 * Attempt to load ONNX Runtime
 */
async function loadOnnxRuntime(): Promise<typeof _onnxRuntime> {
  if (_onnxLoadAttempted) {
    return _onnxRuntime;
  }

  _onnxLoadAttempted = true;

  try {
    // Try to load onnxruntime-node (dynamic import to avoid static type checking)
    const moduleName = 'onnxruntime-node';
    const ort = await import(/* webpackIgnore: true */ moduleName);
    _onnxRuntime = {
      InferenceSession: ort.InferenceSession as unknown as InferenceSessionType,
      Tensor: ort.Tensor as unknown as TensorType,
    };
    return _onnxRuntime;
  } catch {
    // ONNX Runtime not installed
    return null;
  }
}

/**
 * Check if ONNX Runtime is available
 */
export async function isOnnxAvailable(): Promise<boolean> {
  const ort = await loadOnnxRuntime();
  return ort !== null;
}

// ============================================================================
// Prompt Guard Inference
// ============================================================================

export class PromptGuardInference {
  private session: ModelSession | null = null;
  private tokenizer: PromptGuardTokenizer | SimpleTokenizer | null = null;
  private modelPath: string;
  private isLoaded = false;
  private loadError: Error | null = null;

  constructor(modelPath: string) {
    this.modelPath = modelPath;
  }

  /**
   * Load the model and tokenizer
   */
  async load(): Promise<boolean> {
    if (this.isLoaded) return true;
    if (this.loadError) return false;

    try {
      // Check model exists
      const onnxPath = join(this.modelPath, 'model.onnx');
      if (!existsSync(onnxPath)) {
        this.loadError = new Error(`Model not found: ${onnxPath}`);
        return false;
      }

      // Load ONNX Runtime
      const ort = await loadOnnxRuntime();
      if (!ort) {
        this.loadError = new Error('ONNX Runtime not available. Install with: npm install onnxruntime-node');
        return false;
      }

      // Create inference session
      this.session = await ort.InferenceSession.create(onnxPath, {
        executionProviders: ['cpu'],
        graphOptimizationLevel: 'all',
      });

      // Load tokenizer
      try {
        this.tokenizer = new PromptGuardTokenizer(this.modelPath);
      } catch {
        // Fall back to simple tokenizer
        this.tokenizer = new SimpleTokenizer(512);
      }

      this.isLoaded = true;
      return true;
    } catch (error) {
      this.loadError = error as Error;
      return false;
    }
  }

  /**
   * Check if model is loaded
   */
  get loaded(): boolean {
    return this.isLoaded;
  }

  /**
   * Get load error if any
   */
  get error(): Error | null {
    return this.loadError;
  }

  /**
   * Run inference on text
   */
  async infer(text: string): Promise<InferenceResult> {
    const startTime = performance.now();

    // If not loaded, try to load
    if (!this.isLoaded) {
      const loaded = await this.load();
      if (!loaded) {
        // Return fallback result using regex-based detection
        return this.fallbackInfer(text, performance.now() - startTime);
      }
    }

    if (!this.session || !this.tokenizer) {
      return this.fallbackInfer(text, performance.now() - startTime);
    }

    try {
      // Tokenize
      const tokens = this.tokenizer.encode(text, 512);

      // Load ONNX Runtime for Tensor creation
      const ort = await loadOnnxRuntime();
      if (!ort) {
        return this.fallbackInfer(text, performance.now() - startTime);
      }

      // Create tensors
      const inputIds = new ort.Tensor('int64', tokens.inputIds, [1, tokens.inputIds.length]);
      const attentionMask = new ort.Tensor('int64', tokens.attentionMask, [1, tokens.attentionMask.length]);

      // Run inference
      const outputs = await this.session.run({
        input_ids: inputIds,
        attention_mask: attentionMask,
      });

      // Extract logits
      const logits = outputs.logits as { data: Float32Array; dims: number[] } | undefined;
      if (!logits) {
        return this.fallbackInfer(text, performance.now() - startTime);
      }

      // Apply softmax to get probabilities
      const scores = this.softmax(Array.from(logits.data));
      const label = scores.indexOf(Math.max(...scores));

      const latencyMs = performance.now() - startTime;

      return {
        label,
        scores,
        isInjection: label === 1 || (scores[1] ?? 0) > 0.3,
        isJailbreak: label === 2 || (scores[2] ?? 0) > 0.3,
        riskScore: Math.max(scores[1] ?? 0, scores[2] ?? 0),
        latencyMs,
      };
    } catch (error) {
      return this.fallbackInfer(text, performance.now() - startTime);
    }
  }

  /**
   * Softmax function
   */
  private softmax(logits: number[]): number[] {
    const maxLogit = Math.max(...logits);
    const exps = logits.map(l => Math.exp(l - maxLogit));
    const sumExps = exps.reduce((a, b) => a + b, 0);
    return exps.map(e => e / sumExps);
  }

  /**
   * Fallback regex-based detection when model unavailable
   */
  private fallbackInfer(text: string, latencyMs: number): InferenceResult {
    // Injection patterns
    const injectionPatterns = [
      /ignore\s+(previous|all|prior|above)\s+instructions?/i,
      /disregard\s+(previous|all|prior|above)\s+instructions?/i,
      /forget\s+(previous|all|prior|everything)/i,
      /new\s+instructions?:/i,
      /system\s*:\s*/i,
      /\[system\]/i,
      /<system>/i,
      /you\s+are\s+now\s+/i,
      /act\s+as\s+if\s+you/i,
      /pretend\s+(you|that|to\s+be)/i,
      /roleplay\s+as/i,
      /from\s+now\s+on/i,
      /override\s+(your|the|all)/i,
      /bypass\s+(your|the|all)/i,
    ];

    // Jailbreak patterns
    const jailbreakPatterns = [
      /\bDAN\b/,
      /\bdo\s+anything\s+now\b/i,
      /jailbreak/i,
      /\bunrestricted\s+(mode|ai|assistant)/i,
      /\bno\s+restrictions?\b/i,
      /\bwithout\s+(any\s+)?restrictions?\b/i,
      /\bno\s+limits?\b/i,
      /\bno\s+ethical\b/i,
      /\bno\s+moral\b/i,
      /\bignore\s+safety\b/i,
      /\bdisable\s+safety\b/i,
      /\bremove\s+filters?\b/i,
      /\bdisable\s+filters?\b/i,
      /\bbypass\s+content\s+policy/i,
      /\beverything\s+is\s+allowed\b/i,
      /\byou\s+have\s+no\s+rules\b/i,
    ];

    let injectionScore = 0;
    let jailbreakScore = 0;

    for (const pattern of injectionPatterns) {
      if (pattern.test(text)) {
        injectionScore += 0.3;
      }
    }

    for (const pattern of jailbreakPatterns) {
      if (pattern.test(text)) {
        jailbreakScore += 0.3;
      }
    }

    injectionScore = Math.min(injectionScore, 0.95);
    jailbreakScore = Math.min(jailbreakScore, 0.95);

    const benignScore = 1 - Math.max(injectionScore, jailbreakScore);
    const scores = [benignScore, injectionScore, jailbreakScore];
    const label = scores.indexOf(Math.max(...scores));

    return {
      label,
      scores,
      isInjection: injectionScore > 0.3,
      isJailbreak: jailbreakScore > 0.3,
      riskScore: Math.max(injectionScore, jailbreakScore),
      latencyMs,
    };
  }

  /**
   * Release model resources
   */
  async release(): Promise<void> {
    if (this.session) {
      await this.session.release();
      this.session = null;
    }
    this.isLoaded = false;
  }
}

// ============================================================================
// Singleton Inference Manager
// ============================================================================

let _inference: PromptGuardInference | null = null;

export function getInference(modelPath: string): PromptGuardInference {
  if (!_inference || _inference['modelPath'] !== modelPath) {
    _inference = new PromptGuardInference(modelPath);
  }
  return _inference;
}
