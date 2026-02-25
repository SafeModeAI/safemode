/**
 * Tokenizer for Prompt Guard Model
 *
 * Implements BPE tokenization compatible with the Prompt Guard model.
 * Uses tokenizer.json from Hugging Face for vocabulary.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// ============================================================================
// Types
// ============================================================================

export interface TokenizerConfig {
  vocab: Map<string, number>;
  merges: [string, string][];
  specialTokens: Map<string, number>;
  padTokenId: number;
  clsTokenId: number;
  sepTokenId: number;
  unkTokenId: number;
  maxLength: number;
}

export interface TokenizerResult {
  inputIds: BigInt64Array;
  attentionMask: BigInt64Array;
  tokenTypeIds: BigInt64Array;
}

// ============================================================================
// Tokenizer
// ============================================================================

export class PromptGuardTokenizer {
  private config: TokenizerConfig;
  private bpeRanks: Map<string, number> = new Map();
  private cache: Map<string, string[]> = new Map();

  constructor(modelPath: string) {
    this.config = this.loadConfig(modelPath);
    this.buildBpeRanks();
  }

  /**
   * Load tokenizer configuration from model directory
   */
  private loadConfig(modelPath: string): TokenizerConfig {
    const tokenizerPath = join(modelPath, 'tokenizer.json');

    if (!existsSync(tokenizerPath)) {
      throw new Error(`Tokenizer not found: ${tokenizerPath}`);
    }

    const tokenizerJson = JSON.parse(readFileSync(tokenizerPath, 'utf-8'));

    // Build vocabulary from tokenizer.json
    const vocab = new Map<string, number>();
    const model = tokenizerJson.model;

    if (model?.vocab) {
      for (const [token, id] of Object.entries(model.vocab)) {
        vocab.set(token, id as number);
      }
    }

    // Extract merges
    const merges: [string, string][] = [];
    if (model?.merges) {
      for (const merge of model.merges) {
        const parts = merge.split(' ');
        if (parts.length === 2) {
          merges.push([parts[0], parts[1]]);
        }
      }
    }

    // Load special tokens
    const specialTokens = new Map<string, number>();
    let clsTokenId = 0;
    let sepTokenId = 2;
    let padTokenId = 1;
    let unkTokenId = 3;

    if (tokenizerJson.added_tokens) {
      for (const token of tokenizerJson.added_tokens) {
        specialTokens.set(token.content, token.id);
        if (token.content === '[CLS]' || token.content === '<s>') {
          clsTokenId = token.id;
        } else if (token.content === '[SEP]' || token.content === '</s>') {
          sepTokenId = token.id;
        } else if (token.content === '[PAD]' || token.content === '<pad>') {
          padTokenId = token.id;
        } else if (token.content === '[UNK]' || token.content === '<unk>') {
          unkTokenId = token.id;
        }
      }
    }

    // Fallback to vocab lookup for special tokens
    if (!specialTokens.has('[CLS]') && vocab.has('[CLS]')) {
      clsTokenId = vocab.get('[CLS]')!;
    }
    if (!specialTokens.has('<s>') && vocab.has('<s>')) {
      clsTokenId = vocab.get('<s>')!;
    }

    return {
      vocab,
      merges,
      specialTokens,
      padTokenId,
      clsTokenId,
      sepTokenId,
      unkTokenId,
      maxLength: tokenizerJson.truncation?.max_length || 512,
    };
  }

  /**
   * Build BPE ranks lookup
   */
  private buildBpeRanks(): void {
    for (let i = 0; i < this.config.merges.length; i++) {
      const merge = this.config.merges[i];
      if (merge) {
        const [a, b] = merge;
        this.bpeRanks.set(`${a} ${b}`, i);
      }
    }
  }

  /**
   * Get BPE pairs from word
   */
  private getPairs(word: string[]): Set<string> {
    const pairs = new Set<string>();
    for (let i = 0; i < word.length - 1; i++) {
      pairs.add(`${word[i]} ${word[i + 1]}`);
    }
    return pairs;
  }

  /**
   * Apply BPE to a word
   */
  private bpe(token: string): string[] {
    if (this.cache.has(token)) {
      return this.cache.get(token)!;
    }

    let word = token.split('');

    if (word.length === 0) {
      return [];
    }

    if (word.length === 1) {
      return word;
    }

    while (true) {
      const pairs = this.getPairs(word);
      if (pairs.size === 0) break;

      // Find the pair with lowest rank
      let minPair: string | null = null;
      let minRank = Infinity;

      for (const pair of pairs) {
        const rank = this.bpeRanks.get(pair);
        if (rank !== undefined && rank < minRank) {
          minRank = rank;
          minPair = pair;
        }
      }

      if (minPair === null) break;

      const parts = minPair.split(' ');
      const first = parts[0];
      const second = parts[1];

      if (!first || !second) break;

      const newWord: string[] = [];
      let i = 0;

      while (i < word.length) {
        const j = word.indexOf(first, i);
        if (j === -1) {
          newWord.push(...word.slice(i));
          break;
        }

        newWord.push(...word.slice(i, j));
        i = j;

        if (word[i] === first && i < word.length - 1 && word[i + 1] === second) {
          newWord.push(first + second);
          i += 2;
        } else {
          newWord.push(word[i]!);
          i += 1;
        }
      }

      word = newWord;
    }

    this.cache.set(token, word);
    return word;
  }

  /**
   * Tokenize text into token IDs
   */
  private tokenize(text: string): number[] {
    // Basic preprocessing
    text = text.toLowerCase().trim();

    // Split into words with basic regex
    const words = text.split(/\s+/).filter(w => w.length > 0);

    const tokens: number[] = [];

    for (const word of words) {
      // Add space prefix for non-first words (BPE convention)
      const processedWord = tokens.length > 0 ? `Ġ${word}` : word;

      // Apply BPE
      const subwords = this.bpe(processedWord);

      for (const subword of subwords) {
        const id = this.config.vocab.get(subword);
        if (id !== undefined) {
          tokens.push(id);
        } else {
          // Try without space prefix
          const altId = this.config.vocab.get(subword.replace('Ġ', ''));
          if (altId !== undefined) {
            tokens.push(altId);
          } else {
            // Fall back to UNK token
            tokens.push(this.config.unkTokenId);
          }
        }
      }
    }

    return tokens;
  }

  /**
   * Encode text for model input
   */
  encode(text: string, maxLength?: number): TokenizerResult {
    const max = maxLength || this.config.maxLength;

    // Tokenize
    let tokens = this.tokenize(text);

    // Add special tokens: [CLS] tokens [SEP]
    tokens = [this.config.clsTokenId, ...tokens, this.config.sepTokenId];

    // Truncate if necessary
    if (tokens.length > max) {
      tokens = tokens.slice(0, max - 1);
      tokens.push(this.config.sepTokenId);
    }

    // Create attention mask
    const attentionMask = new Array(tokens.length).fill(1);
    const tokenTypeIds = new Array(tokens.length).fill(0);

    // Pad to max length
    while (tokens.length < max) {
      tokens.push(this.config.padTokenId);
      attentionMask.push(0);
      tokenTypeIds.push(0);
    }

    return {
      inputIds: BigInt64Array.from(tokens.map(BigInt)),
      attentionMask: BigInt64Array.from(attentionMask.map(BigInt)),
      tokenTypeIds: BigInt64Array.from(tokenTypeIds.map(BigInt)),
    };
  }

  /**
   * Get vocabulary size
   */
  get vocabSize(): number {
    return this.config.vocab.size;
  }

  /**
   * Get max sequence length
   */
  get maxLength(): number {
    return this.config.maxLength;
  }
}

// ============================================================================
// Simple Fallback Tokenizer
// ============================================================================

/**
 * Simple character-level tokenizer for when full tokenizer unavailable
 */
export class SimpleTokenizer {
  private readonly maxLength: number;
  private readonly padTokenId: number = 0;
  private readonly clsTokenId: number = 1;
  private readonly sepTokenId: number = 2;
  private readonly unkTokenId: number = 3;

  constructor(maxLength: number = 512) {
    this.maxLength = maxLength;
  }

  /**
   * Simple character-based encoding
   */
  encode(text: string, maxLength?: number): TokenizerResult {
    const max = maxLength || this.maxLength;

    // Simple char-level encoding
    const chars = text.toLowerCase().split('').slice(0, max - 2);
    const tokens: number[] = [this.clsTokenId];

    for (const char of chars) {
      // Map characters to token IDs (ASCII + offset)
      const code = char.charCodeAt(0);
      tokens.push(code < 128 ? code + 256 : this.unkTokenId);
    }

    tokens.push(this.sepTokenId);

    // Create masks
    const attentionMask = new Array(tokens.length).fill(1);
    const tokenTypeIds = new Array(tokens.length).fill(0);

    // Pad
    while (tokens.length < max) {
      tokens.push(this.padTokenId);
      attentionMask.push(0);
      tokenTypeIds.push(0);
    }

    return {
      inputIds: BigInt64Array.from(tokens.map(BigInt)),
      attentionMask: BigInt64Array.from(attentionMask.map(BigInt)),
      tokenTypeIds: BigInt64Array.from(tokenTypeIds.map(BigInt)),
    };
  }

  get vocabSize(): number {
    return 512; // Enough for ASCII + special tokens
  }
}
