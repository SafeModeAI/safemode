/**
 * ML Model Manager
 *
 * Handles downloading, caching, and loading ONNX models.
 * Models are downloaded from Hugging Face on first use.
 */

import { createWriteStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';

// ============================================================================
// Types
// ============================================================================

export interface ModelConfig {
  /** Model identifier on Hugging Face */
  hfRepo: string;

  /** Files to download */
  files: string[];

  /** Expected total size in bytes */
  expectedSize: number;

  /** Model version/revision */
  revision: string;
}

export interface ModelInfo {
  /** Path to model directory */
  path: string;

  /** Whether model is downloaded */
  downloaded: boolean;

  /** Size in bytes */
  size: number;

  /** Download date */
  downloadedAt?: Date;
}

export interface DownloadProgress {
  file: string;
  downloaded: number;
  total: number;
  percent: number;
}

export type ProgressCallback = (progress: DownloadProgress) => void;

// ============================================================================
// Model Configurations
// ============================================================================

/**
 * Prompt Guard 2 - 22M parameter model for injection detection
 * https://huggingface.co/meta-llama/Prompt-Guard-2-22M
 */
export const PROMPT_GUARD_MODEL: ModelConfig = {
  hfRepo: 'meta-llama/Prompt-Guard-2-22M',
  files: [
    'model.onnx',
    'tokenizer.json',
    'tokenizer_config.json',
    'special_tokens_map.json',
  ],
  expectedSize: 85 * 1024 * 1024, // ~85MB
  revision: 'main',
};

// ============================================================================
// Model Manager
// ============================================================================

export class ModelManager {
  private readonly cacheDir: string;
  private readonly models: Map<string, ModelConfig> = new Map();

  constructor(cacheDir?: string) {
    this.cacheDir = cacheDir || join(homedir(), '.safemode', 'models');
    this.ensureCacheDir();

    // Register default models
    this.models.set('prompt-guard', PROMPT_GUARD_MODEL);
  }

  /**
   * Ensure cache directory exists
   */
  private ensureCacheDir(): void {
    if (!existsSync(this.cacheDir)) {
      mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  /**
   * Get path to model directory
   */
  getModelPath(modelId: string): string {
    return join(this.cacheDir, modelId);
  }

  /**
   * Check if model is downloaded
   */
  isModelDownloaded(modelId: string): boolean {
    const config = this.models.get(modelId);
    if (!config) return false;

    const modelPath = this.getModelPath(modelId);
    if (!existsSync(modelPath)) return false;

    // Check all required files exist
    for (const file of config.files) {
      const filePath = join(modelPath, file);
      if (!existsSync(filePath)) return false;
    }

    return true;
  }

  /**
   * Get model info
   */
  getModelInfo(modelId: string): ModelInfo {
    const modelPath = this.getModelPath(modelId);
    const downloaded = this.isModelDownloaded(modelId);

    let size = 0;
    let downloadedAt: Date | undefined;

    if (downloaded) {
      const config = this.models.get(modelId);
      if (config) {
        for (const file of config.files) {
          const filePath = join(modelPath, file);
          if (existsSync(filePath)) {
            const stat = statSync(filePath);
            size += stat.size;
            if (!downloadedAt || stat.mtime > downloadedAt) {
              downloadedAt = stat.mtime;
            }
          }
        }
      }
    }

    return {
      path: modelPath,
      downloaded,
      size,
      downloadedAt,
    };
  }

  /**
   * Download model from Hugging Face
   */
  async downloadModel(
    modelId: string,
    onProgress?: ProgressCallback
  ): Promise<string> {
    const config = this.models.get(modelId);
    if (!config) {
      throw new Error(`Unknown model: ${modelId}`);
    }

    const modelPath = this.getModelPath(modelId);

    // Create model directory
    if (!existsSync(modelPath)) {
      mkdirSync(modelPath, { recursive: true });
    }

    // Download each file
    for (const file of config.files) {
      const filePath = join(modelPath, file);

      // Skip if already exists
      if (existsSync(filePath)) {
        continue;
      }

      const url = this.buildHuggingFaceUrl(config.hfRepo, file, config.revision);
      await this.downloadFile(url, filePath, file, onProgress);
    }

    // Save metadata
    const metadataPath = join(modelPath, 'metadata.json');
    await writeFile(
      metadataPath,
      JSON.stringify({
        modelId,
        config,
        downloadedAt: new Date().toISOString(),
      })
    );

    return modelPath;
  }

  /**
   * Build Hugging Face download URL
   */
  private buildHuggingFaceUrl(repo: string, file: string, revision: string): string {
    return `https://huggingface.co/${repo}/resolve/${revision}/${file}`;
  }

  /**
   * Download a single file
   */
  private async downloadFile(
    url: string,
    destPath: string,
    fileName: string,
    onProgress?: ProgressCallback
  ): Promise<void> {
    // Ensure directory exists
    const dir = dirname(destPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    // Use dynamic import for fetch to support older Node versions
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Failed to download ${fileName}: ${response.statusText}`);
    }

    const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
    const body = response.body;

    if (!body) {
      throw new Error(`No response body for ${fileName}`);
    }

    // Create write stream
    const writer = createWriteStream(destPath);
    let downloaded = 0;

    // Read stream
    const reader = body.getReader();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        writer.write(Buffer.from(value));
        downloaded += value.length;

        if (onProgress && contentLength > 0) {
          onProgress({
            file: fileName,
            downloaded,
            total: contentLength,
            percent: Math.round((downloaded / contentLength) * 100),
          });
        }
      }
    } finally {
      writer.end();
    }

    // Wait for write to complete
    await new Promise<void>((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });
  }

  /**
   * Verify model integrity
   */
  async verifyModel(modelId: string): Promise<boolean> {
    if (!this.isModelDownloaded(modelId)) {
      return false;
    }

    const config = this.models.get(modelId);
    if (!config) return false;

    const modelPath = this.getModelPath(modelId);

    // Check all files exist and are non-empty
    for (const file of config.files) {
      const filePath = join(modelPath, file);
      if (!existsSync(filePath)) return false;

      const stat = statSync(filePath);
      if (stat.size === 0) return false;
    }

    return true;
  }

  /**
   * Get all registered model IDs
   */
  getModelIds(): string[] {
    return Array.from(this.models.keys());
  }

  /**
   * Register a custom model
   */
  registerModel(modelId: string, config: ModelConfig): void {
    this.models.set(modelId, config);
  }

  /**
   * Get model configuration
   */
  getModelConfig(modelId: string): ModelConfig | undefined {
    return this.models.get(modelId);
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let _modelManager: ModelManager | null = null;

export function getModelManager(): ModelManager {
  if (!_modelManager) {
    _modelManager = new ModelManager();
  }
  return _modelManager;
}
