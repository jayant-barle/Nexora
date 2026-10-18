// ============================================================================
// Nexora — Local Ollama LLM Client
// Manages local Ollama HTTP API communication (http://127.0.0.1:11434/api/chat)
// Enforces 100% on-device local inference, strict JSON schema validation,
// bounded concurrency (1), configurable timeouts, cancellation & offline security.
// ============================================================================

import { EventEmitter } from 'events';
import type {
  LlmStatus,
  LlmClassificationRequest,
  LlmClassificationResult,
  LlmOrganizeProposalRequest,
  LlmOrganizeProposalResult,
  LlmModelInfo,
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
  defaultModel: 'qwen3:4b',
  contextWindow: 8192,
  temperature: 0.1,
  timeoutMs: 45000,
};

export class LocalLlmService extends EventEmitter {
  private config: OllamaConfig;
  private isProcessing = false;
  private currentAbortController: AbortController | null = null;

  constructor(customConfig?: Partial<OllamaConfig>) {
    super();
    this.config = { ...DEFAULT_OLLAMA_CONFIG, ...customConfig };
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
      // Ollama models can be "qwen3:4b" or "qwen3:4b-instruct" or "qwen3:4b:latest"
      const matched = installedModels.some(
        (m) =>
          m.name.toLowerCase() === modelToCheck.toLowerCase() ||
          m.name.toLowerCase().startsWith(`${modelToCheck.toLowerCase()}:`) ||
          modelToCheck.toLowerCase().startsWith(`${m.name.toLowerCase()}:`)
      );

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
        modelName: modelToCheck,
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

      const userPrompt = JSON.stringify({
        filename: req.filename,
        extension: req.extension,
        size_bytes: req.sizeBytes,
        metadata: req.metadata || {},
        excerpt: req.textExcerpt ? req.textExcerpt.slice(0, 2000) : null,
      });

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
          },
        }),
      });

      if (timeoutId) clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Ollama inference returned HTTP ${response.status}: ${response.statusText}`);
      }

      const rawJson = await response.json() as {
        message?: { content: string };
        total_duration?: number;
        eval_count?: number;
      };

      const contentStr = rawJson.message?.content?.trim();
      if (!contentStr) {
        throw new Error('Ollama returned empty response content');
      }

      const parsed = this.parseAndValidateClassificationJson(contentStr, req.extension);
      parsed.latencyMs = Date.now() - startTime;
      parsed.modelUsed = targetModel;
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
      const systemPrompt = `You are Nexora's local organization advisor.
Recommend a logical, structured relative destination folder hierarchy for a file based on its metadata.
Respond ONLY with a valid JSON object matching this schema:
{
  "relative_folder": "Category/Subfolder/2026",
  "reasoning": "Brief explanation of rule selection",
  "rule_name": "AI Recommended Hierarchy",
  "warnings": []
}
Strict Rules:
- Never include drive letters or leading slashes.
- Never use path traversal sequences (no '..').
- Separate folder levels with forward slashes (e.g. 'Documents/Financial/2026').
- If metadata is ambiguous, fallback to 'Unclassified'.`;

      const userPrompt = JSON.stringify({
        filename: req.filename,
        extension: req.extension,
        metadata: req.metadataSnapshot || {},
        confirmed_person: req.confirmedPerson || null,
        available_rules: req.availableRules || [],
      });

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
          },
        }),
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Ollama inference returned HTTP ${response.status}: ${response.statusText}`);
      }

      const rawJson = await response.json() as {
        message?: { content: string };
      };

      const contentStr = rawJson.message?.content?.trim();
      if (!contentStr) {
        throw new Error('Ollama returned empty proposal content');
      }

      const parsed = this.parseAndValidateProposalJson(contentStr, req.extension);
      parsed.latencyMs = Date.now() - startTime;
      parsed.modelUsed = targetModel;
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
    try {
      obj = JSON.parse(raw);
    } catch {
      throw new Error(`Malformed JSON organization proposal from local LLM: ${raw.slice(0, 100)}`);
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

    return {
      relativeFolder: safeFolder,
      reasoning,
      ruleName,
      warnings,
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
