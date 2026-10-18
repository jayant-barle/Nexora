// ============================================================================
// Nexora — Local Ollama LLM Client
// Manages local Ollama HTTP API communication (http://127.0.0.1:11434/api/chat)
// Enforces 100% on-device local inference, strict JSON schema validation,
// bounded concurrency (1), configurable timeouts, cancellation & offline security.
// ============================================================================

import { EventEmitter } from 'events';
import crypto from 'crypto';
import type {
  LlmStatus,
  LlmClassificationRequest,
  LlmClassificationResult,
  LlmOrganizeProposalRequest,
  LlmOrganizeProposalResult,
  LlmQueryTranslationResult,
  LlmModelInfo,
  SearchQuery,
} from '../shared/types';
import { sanitizePathSegment, getFileCategory } from './organizer';

export interface OllamaConfig {
  baseUrl: string;
  defaultModel: string;
  contextWindow: number;
  temperature: number;
  timeoutMs: number;
}

export const DEFAULT_OLLAMA_CONFIG: OllamaConfig = {
  baseUrl: 'http://127.0.0.1:11434',
  defaultModel: 'qwen3-vl:8b',
  contextWindow: 4096,
  temperature: 0.1,
  timeoutMs: 90000,
};

export class LocalLlmService extends EventEmitter {
  private config: OllamaConfig;
  private isProcessing = false;
  private currentAbortController: AbortController | null = null;
  private classificationCache = new Map<string, LlmClassificationResult>();
  private proposalCache = new Map<string, LlmOrganizeProposalResult>();
  private maxCacheEntries = 500;

  constructor(customConfig?: Partial<OllamaConfig>) {
    super();
    this.config = { ...DEFAULT_OLLAMA_CONFIG, ...customConfig };
  }

  public getCacheSize(): { classification: number; proposals: number } {
    return {
      classification: this.classificationCache.size,
      proposals: this.proposalCache.size,
    };
  }

  public clearCache(): void {
    this.classificationCache.clear();
    this.proposalCache.clear();
  }

  public getConfig(): OllamaConfig {
    return { ...this.config };
  }

  public updateConfig(newConfig: Partial<OllamaConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  // ─── Health & Model Availability Checks ────────────────────────────────────

  /**
   * Probes Ollama service health and verifies model availability.
   * Never triggers a download.
   */
  public async getStatus(targetModel?: string): Promise<LlmStatus> {
    const modelToCheck = targetModel || this.config.defaultModel;

    // Check Ollama daemon accessibility
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);

      const res = await fetch(`${this.config.baseUrl}/api/tags`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!res.ok) {
        return {
          state: 'unavailable',
          isAvailable: false,
          modelName: modelToCheck,
          isModelReady: false,
          baseUrl: this.config.baseUrl,
          errorMessage: `Ollama returned HTTP ${res.status}: ${res.statusText}`,
        };
      }

      const data = await res.json() as { models?: Array<{ name: string; size?: number; modified_at?: string; details?: any }> };
      const installedModels: LlmModelInfo[] = (data.models || []).map((m) => ({
        name: m.name,
        sizeBytes: m.size,
        modifiedAt: m.modified_at,
        parameterSize: m.details?.parameter_size,
        quantization: m.details?.quantization_level,
      }));

      // Check if requested model or tag is installed
      // Ollama models can be "qwen3-vl:8b" or "qwen3:4b" or "llama3.2:1b"
      let effectiveModel = modelToCheck;
      let matched = installedModels.some(
        (m) =>
          m.name.toLowerCase() === modelToCheck.toLowerCase() ||
          m.name.toLowerCase().startsWith(`${modelToCheck.toLowerCase()}:`) ||
          modelToCheck.toLowerCase().startsWith(`${m.name.toLowerCase()}:`)
      );

      // Auto-fallback to installed local model if configured default isn't found
      if (!matched && !targetModel && installedModels.length > 0) {
        // Look for any installed qwen variant first, then llama, or the first available installed model
        const bestInstalled =
          installedModels.find((m) => m.name.toLowerCase().includes('qwen')) ||
          installedModels.find((m) => m.name.toLowerCase().includes('llama')) ||
          installedModels[0];

        if (bestInstalled) {
          effectiveModel = bestInstalled.name;
          matched = true;
          this.config.defaultModel = effectiveModel;
        }
      }

      if (!matched) {
        return {
          state: 'model_missing',
          isAvailable: true,
          modelName: modelToCheck,
          isModelReady: false,
          baseUrl: this.config.baseUrl,
          availableModels: installedModels,
          errorMessage: `Model '${modelToCheck}' is not installed in local Ollama. Run: 'ollama pull ${modelToCheck}' in terminal.`,
        };
      }

      return {
        state: this.isProcessing ? 'processing' : 'completed',
        isAvailable: true,
        modelName: effectiveModel,
        isModelReady: true,
        baseUrl: this.config.baseUrl,
        availableModels: installedModels,
      };
    } catch (err: any) {
      return {
        state: 'unavailable',
        isAvailable: false,
        modelName: modelToCheck,
        isModelReady: false,
        baseUrl: this.config.baseUrl,
        errorMessage: err.name === 'AbortError'
          ? `Ollama connection timed out at ${this.config.baseUrl}`
          : `Ollama service is unreachable at ${this.config.baseUrl}. Ensure Ollama is running.`,
      };
    }
  }

  // ─── Inference Cancellation ────────────────────────────────────────────────

  public cancelActiveRequest(): boolean {
    if (this.currentAbortController) {
      this.currentAbortController.abort();
      this.currentAbortController = null;
      this.isProcessing = false;
      return true;
    }
    return false;
  }

  // ─── Classification & Semantic Tagging ─────────────────────────────────────

  /**
   * Analyzes file metadata and text excerpts to produce safe classification and tags.
   */
  public async classifyFile(
    req: LlmClassificationRequest,
    modelOverride?: string
  ): Promise<LlmClassificationResult> {
    const targetModel = modelOverride || this.config.defaultModel;

    // Concurrency guard: 1 concurrent request
    if (this.isProcessing) {
      throw new Error('Local LLM inference already in progress. Only 1 concurrent inference is permitted.');
    }

    // Check cache
    const cacheKey = crypto
      .createHash('sha256')
      .update(`${targetModel}:${req.filename}:${req.extension}:${req.sizeBytes}:${JSON.stringify(req.metadata || {})}:${req.textExcerpt || ''}`)
      .digest('hex');

    const cached = this.classificationCache.get(cacheKey);
    if (cached) {
      return { ...cached, latencyMs: 0 };
    }

    this.isProcessing = true;
    const controller = new AbortController();
    this.currentAbortController = controller;
    let timeoutId: NodeJS.Timeout | null = null;

    try {
      // Health & model check
      const status = await this.getStatus(targetModel);
      if (!status.isAvailable) {
        throw new Error(`Local Ollama service unavailable: ${status.errorMessage}`);
      }
      if (!status.isModelReady) {
        throw new Error(`Required model unavailable: ${status.errorMessage}`);
      }

      timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);
      const startTime = Date.now();

      const systemPrompt = `You are Nexora's local-only metadata intelligence engine.
Analyze the provided file metadata and content excerpt.
Respond ONLY with a valid JSON object matching this schema:
{
  "category": "document" | "image" | "video" | "audio" | "archive" | "code" | "other",
  "tags": ["tag1", "tag2"],
  "summary": "1-2 sentence factual summary",
  "suggested_folder": "SingleFolderName",
  "confidence": 0.0 to 1.0
}
Strict Rules:
- Output MUST be pure JSON with no markdown wrapping (no \`\`\`json).
- Never invent facts; rely strictly on the provided metadata and excerpt.
- Keep tags concise, alphanumeric, lowercase, and relevant (max 6 tags).
- suggested_folder must be a clean folder name without path separators.`;

      const userPromptLines: string[] = [
        `Filename: ${req.filename}`,
        `Extension: ${req.extension}`,
        `Size: ${req.sizeBytes} bytes`,
      ];
      if (req.metadata && Object.keys(req.metadata).length > 0) {
        userPromptLines.push(`Metadata: ${JSON.stringify(req.metadata)}`);
      }
      if (req.textExcerpt) {
        userPromptLines.push(`Excerpt: ${req.textExcerpt.slice(0, 2000)}`);
      }
      const userPrompt = userPromptLines.join('\n');

      const response = await fetch(`${this.config.baseUrl}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: targetModel,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          format: 'json',
          stream: false,
          options: {
            temperature: this.config.temperature,
            num_ctx: this.config.contextWindow,
            stop: ['<think>'],
          },
        }),
      });

      if (timeoutId) clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Ollama inference returned HTTP ${response.status}: ${response.statusText}`);
      }

      const rawJson = await response.json() as {
        message?: { content?: string; thinking?: string };
        response?: string;
        total_duration?: number;
        eval_count?: number;
      };

      let contentStr = rawJson.message?.content?.trim() || rawJson.response?.trim();
      if (!contentStr && rawJson.message?.thinking) {
        const jsonMatch = rawJson.message.thinking.match(/\{[\s\S]*\}/);
        if (jsonMatch) contentStr = jsonMatch[0];
      }

      if (!contentStr) {
        throw new Error('Ollama returned empty response content');
      }

      const parsed = this.parseAndValidateClassificationJson(contentStr, req.extension);
      parsed.latencyMs = Date.now() - startTime;
      parsed.modelUsed = targetModel;

      // Cache valid result
      if (this.classificationCache.size >= this.maxCacheEntries) {
        const firstKey = this.classificationCache.keys().next().value;
        if (firstKey) this.classificationCache.delete(firstKey);
      }
      this.classificationCache.set(cacheKey, parsed);

      return parsed;
    } catch (err: any) {
      if (err.name === 'AbortError' || err.message?.includes('AbortError')) {
        throw new Error(`LLM inference aborted or exceeded timeout of ${this.config.timeoutMs}ms`);
      }
      throw err;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      this.currentAbortController = null;
      this.isProcessing = false;
    }
  }

  // ─── Organization Recommendation ──────────────────────────────────────────

  /**
   * Recommends safe organization subfolders for a file based on metadata.
   * Never executes filesystem operations.
   */
  public async recommendOrganization(
    req: LlmOrganizeProposalRequest,
    modelOverride?: string
  ): Promise<LlmOrganizeProposalResult> {
    const targetModel = modelOverride || this.config.defaultModel;

    // Check proposal cache
    const cacheKey = crypto
      .createHash('sha256')
      .update(`${targetModel}:${req.filename}:${req.extension}:${JSON.stringify(req.metadataSnapshot || {})}:${req.confirmedPerson || ''}:${JSON.stringify(req.availableRules || [])}`)
      .digest('hex');

    const cached = this.proposalCache.get(cacheKey);
    if (cached) {
      return { ...cached, latencyMs: 0 };
    }

    if (this.isProcessing) {
      throw new Error('Local LLM inference already in progress. Only 1 concurrent inference is permitted.');
    }

    const status = await this.getStatus(targetModel);
    if (!status.isAvailable) {
      throw new Error(`Local Ollama service unavailable: ${status.errorMessage}`);
    }
    if (!status.isModelReady) {
      throw new Error(`Required model unavailable: ${status.errorMessage}`);
    }

    this.isProcessing = true;
    const controller = new AbortController();
    this.currentAbortController = controller;
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);
    const startTime = Date.now();

    try {
      const systemPrompt = `You are Nexora's local file organization advisor.
Return ONLY a valid JSON object matching this schema:
{
  "category": "document" | "image" | "video" | "audio" | "archive" | "code" | "other",
  "relative_folder": "Category/Subfolder/YYYY",
  "reasoning": "Brief factual explanation",
  "rule_name": "AI Recommended Hierarchy",
  "confidence": 0.95,
  "warnings": []
}
Rules:
- Output pure JSON only.
- relative_folder must use forward slashes with no drive letters or '..' traversal.
- Ambiguous files go to folder Review_Unclassified.`;

      const userPromptLines: string[] = [
        `Filename: ${req.filename}`,
        `Extension: ${req.extension}`,
      ];
      if (req.confirmedPerson) {
        userPromptLines.push(`Confirmed Person: ${req.confirmedPerson}`);
      }
      if (req.metadataSnapshot && Object.keys(req.metadataSnapshot).length > 0) {
        userPromptLines.push(`Metadata: ${JSON.stringify(req.metadataSnapshot)}`);
      }
      if (req.availableRules && req.availableRules.length > 0) {
        userPromptLines.push(`Available Rules: ${req.availableRules.join(', ')}`);
      }
      const userPrompt = userPromptLines.join('\n');

      const response = await fetch(`${this.config.baseUrl}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: targetModel,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          format: 'json',
          stream: false,
          options: {
            temperature: this.config.temperature,
            num_ctx: this.config.contextWindow,
            stop: ['<think>'],
          },
        }),
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Ollama inference returned HTTP ${response.status}: ${response.statusText}`);
      }

      const rawJson = await response.json() as {
        message?: { content?: string; thinking?: string };
        response?: string;
      };

      let contentStr = rawJson.message?.content?.trim() || rawJson.response?.trim();
      if (!contentStr && rawJson.message?.thinking) {
        const jsonMatch = rawJson.message.thinking.match(/\{[^{}]*?"relative_folder"[\s\S]*?\}/) ||
                          rawJson.message.thinking.match(/\{[^{}]*?"category"[\s\S]*?\}/) ||
                          rawJson.message.thinking.match(/\{[\s\S]*\}/);
        if (jsonMatch) contentStr = jsonMatch[0];
      }

      if (!contentStr) {
        console.warn('[LocalLLM] Empty content. rawJson was:', JSON.stringify(rawJson).slice(0, 500));
        throw new Error(`Ollama returned empty proposal content. rawJson: ${JSON.stringify(rawJson).slice(0, 300)}`);
      }

      const parsed = this.parseAndValidateProposalJson(contentStr, req.extension);
      parsed.latencyMs = Date.now() - startTime;
      parsed.modelUsed = targetModel;

      // Cache proposal
      if (this.proposalCache.size >= this.maxCacheEntries) {
        const firstKey = this.proposalCache.keys().next().value;
        if (firstKey) this.proposalCache.delete(firstKey);
      }
      this.proposalCache.set(cacheKey, parsed);

      return parsed;
    } catch (err: any) {
      if (err.name === 'AbortError') {
        throw new Error(`LLM inference aborted or exceeded timeout of ${this.config.timeoutMs}ms`);
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
      this.currentAbortController = null;
      this.isProcessing = false;
    }
  }

  // ─── Schema Validation & Untrusted Data Sanitization ───────────────────────

  public parseAndValidateClassificationJson(raw: string, ext: string): LlmClassificationResult {
    let obj: any;
    try {
      obj = JSON.parse(raw);
    } catch {
      throw new Error(`Malformed JSON output from local LLM: ${raw.slice(0, 100)}`);
    }

    if (!obj || typeof obj !== 'object') {
      throw new Error('LLM output was not a valid JSON object');
    }

    // Validate category against strict enum
    const validCategories = ['document', 'image', 'video', 'audio', 'archive', 'code', 'other'];
    const categoryMap: Record<string, string> = {
      documents: 'document',
      images: 'image',
      videos: 'video',
      archives: 'archive',
      text: 'document',
      spreadsheets: 'document',
      spreadsheet: 'document',
      presentations: 'document',
      presentation: 'document',
      audios: 'audio',
      codes: 'code',
    };

    let category = typeof obj.category === 'string' ? obj.category.toLowerCase().trim() : '';
    if (categoryMap[category]) {
      category = categoryMap[category];
    }

    if (!validCategories.includes(category)) {
      const fallback = getFileCategory(ext).toLowerCase();
      category = categoryMap[fallback] || (validCategories.includes(fallback) ? fallback : 'other');
    }

    // Sanitize tags
    const rawTags = Array.isArray(obj.tags) ? obj.tags : [];
    const sanitizedTags = rawTags
      .filter((t: any) => typeof t === 'string' && t.trim().length > 0)
      .map((t: string) => sanitizePathSegment(t.toLowerCase().trim()).slice(0, 30))
      .filter((t: string) => t !== 'Unknown' && t.length > 1)
      .slice(0, 8);

    // Sanitize suggested folder
    let suggestedFolder = sanitizePathSegment(
      typeof obj.suggested_folder === 'string' ? obj.suggested_folder : 'General'
    );
    if (!suggestedFolder || suggestedFolder.includes('..')) {
      suggestedFolder = 'General';
    }

    // Sanitize summary
    const summary = typeof obj.summary === 'string'
      ? obj.summary.trim().slice(0, 500)
      : 'No summary generated.';

    const confidence = typeof obj.confidence === 'number' && !isNaN(obj.confidence)
      ? Math.max(0, Math.min(1, obj.confidence))
      : 0.85;

    return {
      category: category as any,
      tags: sanitizedTags,
      summary,
      suggestedFolder,
      confidence,
      modelUsed: this.config.defaultModel,
      latencyMs: 0,
    };
  }

  public parseAndValidateProposalJson(raw: string, ext: string): LlmOrganizeProposalResult {
    let obj: any;
    let cleaned = (raw || '').trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    }
    try {
      obj = JSON.parse(cleaned);
    } catch {
      const match = cleaned.match(/\{[^{}]*?"relative_folder"[\s\S]*?\}/) ||
                    cleaned.match(/\{[^{}]*?"category"[\s\S]*?\}/) ||
                    cleaned.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          obj = JSON.parse(match[0]);
        } catch {}
      }
      if (!obj) {
        throw new Error(`Malformed JSON organization proposal from local LLM: ${raw.slice(0, 100)}`);
      }
    }

    if (!obj || typeof obj !== 'object') {
      throw new Error('Proposal output was not a valid JSON object');
    }

    const rawFolder = typeof obj.relative_folder === 'string' ? obj.relative_folder.trim() : '';
    const warnings: string[] = [];

    // Path traversal check
    if (rawFolder.includes('..') || rawFolder.startsWith('/') || rawFolder.startsWith('\\') || /^[a-zA-Z]:/.test(rawFolder)) {
      warnings.push('Unsafe path pattern detected in LLM recommendation; sanitized to Review_Unclassified');
    }

    // Segment sanitization
    const segments = rawFolder
      .split(/[\\/]+/)
      .map((s: string) => sanitizePathSegment(s))
      .filter((s: string) => s && s !== 'Unknown');

    let safeFolder = segments.length > 0 ? segments.join('/') : 'Review_Unclassified';
    if (warnings.length > 0) {
      safeFolder = 'Review_Unclassified';
    }

    const reasoning = typeof obj.reasoning === 'string'
      ? obj.reasoning.trim().slice(0, 300)
      : 'Rule recommendation';

    const ruleName = typeof obj.rule_name === 'string'
      ? sanitizePathSegment(obj.rule_name).slice(0, 50)
      : 'AI Recommendation';

    // Validate category against strict enum
    const validCategories = ['document', 'image', 'video', 'audio', 'archive', 'code', 'other'];
    const categoryMap: Record<string, string> = {
      documents: 'document',
      images: 'image',
      videos: 'video',
      archives: 'archive',
      text: 'document',
      spreadsheets: 'document',
      spreadsheet: 'document',
      presentations: 'document',
      presentation: 'document',
      audios: 'audio',
      codes: 'code',
    };
    let category = typeof obj.category === 'string' ? obj.category.toLowerCase().trim() : '';
    if (categoryMap[category]) category = categoryMap[category];
    if (!validCategories.includes(category)) {
      const fallback = getFileCategory(ext).toLowerCase();
      category = categoryMap[fallback] || (validCategories.includes(fallback) ? fallback : 'other');
    }

    const confidence = typeof obj.confidence === 'number' && !isNaN(obj.confidence)
      ? Math.max(0, Math.min(1, obj.confidence))
      : 0.85;

    return {
      relativeFolder: safeFolder,
      reasoning,
      ruleName,
      warnings,
      category: category as any,
      confidence,
      modelUsed: this.config.defaultModel,
      latencyMs: 0,
    };
  }

  // ─── Natural Language Search Translation ───────────────────────────────────

  /**
   * Translates a natural language query into validated structured SearchQuery filters.
   * Untrusted suggestions only; all resulting fields are validated against the schema.
   */
  public async translateNaturalLanguageQuery(
    naturalQuery: string,
    modelOverride?: string
  ): Promise<LlmQueryTranslationResult> {
    const cleanPrompt = naturalQuery ? naturalQuery.trim() : '';
    if (!cleanPrompt) {
      return {
        searchQuery: {},
        explanation: 'Empty search query',
        modelUsed: this.config.defaultModel,
        latencyMs: 0,
      };
    }

    const targetModel = modelOverride || this.config.defaultModel;

    if (this.isProcessing) {
      throw new Error('Local LLM inference already in progress. Only 1 concurrent inference is permitted.');
    }

    const status = await this.getStatus(targetModel);
    if (!status.isAvailable || !status.isModelReady) {
      // Graceful fallback: return simple text search query without failing user search
      return {
        searchQuery: { text: cleanPrompt },
        explanation: 'Local LLM unavailable; fell back to full-text search',
        modelUsed: 'fallback',
        latencyMs: 0,
      };
    }

    this.isProcessing = true;
    const controller = new AbortController();
    this.currentAbortController = controller;
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);
    const startTime = Date.now();

    try {
      const systemPrompt = `You are Nexora's local search assistant.
Translate a user's natural language file search query into structured search filter criteria.
Respond ONLY with a valid JSON object matching this schema:
{
  "text": "optional keywords to search in filenames and fulltext",
  "filename": "optional specific filename snippet",
  "extension": ["optional", "file", "extensions", "without", "dot"],
  "category": "all" | "image" | "video" | "document" | "audio" | "archive" | "text" | "other",
  "camera": "optional camera make/model name",
  "author": "optional document author or photographer",
  "artist": "optional audio artist",
  "dateFrom": "optional YYYY-MM-DD",
  "dateTo": "optional YYYY-MM-DD",
  "explanation": "Brief 1-sentence explanation of what was extracted"
}
Strict Rules:
- Never invent search parameters that were not requested.
- Keep keywords clean without quotes or boolean operators.
- Dates must be strictly in YYYY-MM-DD format if present.`;

      const response = await fetch(`${this.config.baseUrl}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: targetModel,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: JSON.stringify({ query: cleanPrompt }) },
          ],
          format: 'json',
          stream: false,
          options: {
            temperature: 0.0,
            num_ctx: 4096,
          },
        }),
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Ollama returned HTTP ${response.status}: ${response.statusText}`);
      }

      const rawJson = await response.json() as { message?: { content: string } };
      const contentStr = rawJson.message?.content?.trim();
      if (!contentStr) {
        throw new Error('Ollama returned empty search translation');
      }

      const parsed = this.parseAndValidateSearchQueryJson(contentStr, cleanPrompt);
      parsed.latencyMs = Date.now() - startTime;
      parsed.modelUsed = targetModel;
      return parsed;
    } catch {
      // Resilient fallback to simple keyword search
      return {
        searchQuery: { text: cleanPrompt },
        explanation: 'Fell back to text search due to inference error',
        modelUsed: 'fallback',
        latencyMs: Date.now() - startTime,
      };
    } finally {
      clearTimeout(timeoutId);
      this.currentAbortController = null;
      this.isProcessing = false;
    }
  }

  public parseAndValidateSearchQueryJson(raw: string, originalQuery: string): LlmQueryTranslationResult {
    let obj: any;
    try {
      obj = JSON.parse(raw);
    } catch {
      return {
        searchQuery: { text: originalQuery },
        explanation: 'Invalid JSON returned; defaulted to text search',
        modelUsed: this.config.defaultModel,
        latencyMs: 0,
      };
    }

    if (!obj || typeof obj !== 'object') {
      return {
        searchQuery: { text: originalQuery },
        explanation: 'Invalid structure returned; defaulted to text search',
        modelUsed: this.config.defaultModel,
        latencyMs: 0,
      };
    }

    const searchQuery: SearchQuery = {};

    if (typeof obj.text === 'string' && obj.text.trim()) {
      searchQuery.text = obj.text.trim().slice(0, 100);
    } else if (!obj.filename && !obj.category && !obj.camera && !obj.author && !obj.artist) {
      searchQuery.text = originalQuery.slice(0, 100);
    }

    if (typeof obj.filename === 'string' && obj.filename.trim()) {
      searchQuery.filename = obj.filename.trim().slice(0, 100);
    }

    if (Array.isArray(obj.extension)) {
      const validExts = obj.extension
        .filter((e: any) => typeof e === 'string' && e.trim())
        .map((e: string) => (e.startsWith('.') ? e.toLowerCase().trim() : `.${e.toLowerCase().trim()}`))
        .slice(0, 5);
      if (validExts.length > 0) searchQuery.extension = validExts;
    }

    const validCategories = ['all', 'image', 'video', 'document', 'audio', 'archive', 'text', 'other'];
    if (typeof obj.category === 'string' && validCategories.includes(obj.category.toLowerCase().trim())) {
      searchQuery.category = obj.category.toLowerCase().trim() as any;
    }

    if (typeof obj.camera === 'string' && obj.camera.trim()) {
      searchQuery.camera = obj.camera.trim().slice(0, 50);
    }

    if (typeof obj.author === 'string' && obj.author.trim()) {
      searchQuery.author = obj.author.trim().slice(0, 50);
    }

    if (typeof obj.artist === 'string' && obj.artist.trim()) {
      searchQuery.artist = obj.artist.trim().slice(0, 50);
    }

    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (typeof obj.dateFrom === 'string' && dateRegex.test(obj.dateFrom.trim())) {
      searchQuery.dateFrom = obj.dateFrom.trim();
    }
    if (typeof obj.dateTo === 'string' && dateRegex.test(obj.dateTo.trim())) {
      searchQuery.dateTo = obj.dateTo.trim();
    }

    const explanation = typeof obj.explanation === 'string' && obj.explanation.trim()
      ? obj.explanation.trim().slice(0, 200)
      : 'Natural language search query translated.';

    return {
      searchQuery,
      explanation,
      modelUsed: this.config.defaultModel,
      latencyMs: 0,
    };
  }
}

// Singleton instance
let _localLlmService: LocalLlmService | null = null;

export function getLocalLlmService(): LocalLlmService {
  if (!_localLlmService) {
    _localLlmService = new LocalLlmService();
  }
  return _localLlmService;
}
