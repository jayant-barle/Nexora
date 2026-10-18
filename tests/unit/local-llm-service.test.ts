// ============================================================================
// Unit & Integration Tests: Local Ollama LLM Service (Qwen3 4B Target)
// Tests: Health checks, missing model detection, timeouts, cancellation,
// schema validation, untrusted output sanitization, bounded concurrency.
// ============================================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LocalLlmService, DEFAULT_OLLAMA_CONFIG } from '../../src/main/local-llm-service';

describe('LocalLlmService — Schema Validation, Security & Guardrails', () => {
  let service: LocalLlmService;

  beforeEach(() => {
    service = new LocalLlmService({
      baseUrl: 'http://127.0.0.1:11434',
      defaultModel: 'qwen3:4b',
      timeoutMs: 5000,
    });
  });

  // ── Schema Validation & Untrusted Output Sanitization ─────────────────────

  it('validates and sanitizes standard classification JSON output', () => {
    const rawOutput = JSON.stringify({
      category: 'document',
      tags: ['FINANCIAL', 'audit', 'confidential!!', '<script>alert(1)</script>'],
      summary: 'Q3 financial report showing strong revenue growth.',
      suggested_folder: 'Financial/Reports',
      confidence: 0.95,
    });

    const validated = service.parseAndValidateClassificationJson(rawOutput, '.xlsx');

    expect(validated.category).toBe('document');
    expect(validated.confidence).toBe(0.95);
    expect(validated.summary).toBe('Q3 financial report showing strong revenue growth.');
    // Slashes and forbidden characters should be sanitized out of suggested_folder
    expect(validated.suggestedFolder).not.toContain('/');
    expect(validated.suggestedFolder).toBe('Financial_Reports');
    // Tags should be lowercased, stripped of dangerous characters
    expect(validated.tags).toContain('financial');
    expect(validated.tags).toContain('audit');
    expect(validated.tags.every((t) => !t.includes('<') && !t.includes('>'))).toBe(true);
  });

  it('rejects malformed non-JSON output and throws explicit error', () => {
    const malformed = 'I cannot output JSON right now: Here is your summary: Q3 report.';
    expect(() => {
      service.parseAndValidateClassificationJson(malformed, '.pdf');
    }).toThrow(/Malformed JSON output/);
  });

  it('falls back to extension category if model returns an invalid or fabricated category', () => {
    const rawWithInvalidCat = JSON.stringify({
      category: 'teleportation_device',
      tags: ['device'],
      summary: 'Invalid category test',
      suggested_folder: 'Devices',
      confidence: 0.8,
    });

    const validated = service.parseAndValidateClassificationJson(rawWithInvalidCat, '.docx');
    expect(validated.category).toBe('document');
  });

  it('neutralizes path traversal attempts in organization proposal output', () => {
    const maliciousRaw = JSON.stringify({
      relative_folder: '../../../../Windows/System32',
      reasoning: 'Exploit attempt via model hallucination',
      rule_name: 'Malicious Rule',
    });

    const validated = service.parseAndValidateProposalJson(maliciousRaw, '.pdf');
    expect(validated.relativeFolder).toBe('Review_Unclassified');
    expect(validated.warnings.length).toBeGreaterThan(0);
    expect(validated.warnings.some((w) => w.includes('Unsafe path pattern'))).toBe(true);
  });

  it('neutralizes absolute drive paths in organization proposal output', () => {
    const absoluteRaw = JSON.stringify({
      relative_folder: 'C:/Windows/System32',
      reasoning: 'Absolute path proposal',
      rule_name: 'Absolute Rule',
    });

    const validated = service.parseAndValidateProposalJson(absoluteRaw, '.jpg');
    expect(validated.relativeFolder).toBe('Review_Unclassified');
  });

  // ── Error Handling: Unreachable Service & Missing Models ───────────────────

  it('reports unavailable state when Ollama service cannot be reached', async () => {
    const unreachableService = new LocalLlmService({
      baseUrl: 'http://127.0.0.1:59999', // Non-existent port
      timeoutMs: 1000,
    });

    const status = await unreachableService.getStatus('qwen3:4b');
    expect(status.isAvailable).toBe(false);
    expect(status.state).toBe('unavailable');
    expect(status.errorMessage).toContain('unreachable');
  });

  it('detects model_missing state and provides actionable setup guidance', async () => {
    // Mock global fetch to return Ollama tags without qwen3:4b
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        models: [
          { name: 'llama3.2:1b', size: 1321098329 },
        ],
      }),
    } as any);

    try {
      const status = await service.getStatus('qwen3:4b');
      expect(status.isAvailable).toBe(true);
      expect(status.isModelReady).toBe(false);
      expect(status.state).toBe('model_missing');
      expect(status.errorMessage).toContain("ollama pull qwen3:4b");
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('detects ready state when model is present in local Ollama catalog', async () => {
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        models: [
          { name: 'qwen3:4b', size: 2500000000, details: { parameter_size: '4.0B', quantization_level: 'Q4_K_M' } },
        ],
      }),
    } as any);

    try {
      const status = await service.getStatus('qwen3:4b');
      expect(status.isAvailable).toBe(true);
      expect(status.isModelReady).toBe(true);
      expect(status.state).toBe('completed');
    } finally {
      global.fetch = originalFetch;
    }
  });

  // ── Bounded Concurrency & Cancellation ─────────────────────────────────────

  it('enforces 1 concurrent inference request limit', async () => {
    const originalFetch = global.fetch;
    let resolveFirst: Function;
    const slowPromise = new Promise((res) => {
      resolveFirst = res;
    });

    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/tags')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ models: [{ name: 'qwen3:4b' }] }),
        });
      }
      return slowPromise;
    });

    try {
      const p1 = service.classifyFile({
        filename: 'doc1.pdf',
        extension: '.pdf',
        sizeBytes: 1024,
      });

      // Allow microtask to enter fetch execution
      await new Promise((r) => setTimeout(r, 10));

      // Second request immediately should be rejected
      await expect(
        service.classifyFile({
          filename: 'doc2.pdf',
          extension: '.pdf',
          sizeBytes: 2048,
        })
      ).rejects.toThrow(/already in progress/);

      // Resolve first
      resolveFirst!({
        ok: true,
        json: async () => ({
          message: {
            content: JSON.stringify({
              category: 'document',
              tags: ['test'],
              summary: 'Test summary',
              suggested_folder: 'Docs',
              confidence: 0.9,
            }),
          },
        }),
      });

      const res1 = await p1;
      expect(res1.category).toBe('document');
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('supports cancellation of in-flight inference requests', async () => {
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockImplementation((url: string, opts: any) => {
      if (url.includes('/api/tags')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ models: [{ name: 'qwen3:4b' }] }),
        });
      }
      return new Promise((_, reject) => {
        opts.signal.addEventListener('abort', () => {
          const abortError = new Error('AbortError');
          abortError.name = 'AbortError';
          reject(abortError);
        });
      });
    });

    try {
      const p = service.classifyFile({
        filename: 'long_document.pdf',
        extension: '.pdf',
        sizeBytes: 100000,
      });

      // Allow microtask to set controller and enter fetch
      await new Promise((r) => setTimeout(r, 10));

      // Cancel while in flight
      const cancelled = service.cancelActiveRequest();
      expect(cancelled).toBe(true);

      await expect(p).rejects.toThrow(/aborted or exceeded timeout/);
    } finally {
      global.fetch = originalFetch;
    }
  });

  // ── Result Caching & Reuse ────────────────────────────────────────────────

  it('reuses cached classification result for identical file fingerprint', async () => {
    const originalFetch = global.fetch;
    let callCount = 0;
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/tags')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ models: [{ name: 'qwen3-vl:8b' }] }),
        });
      }
      callCount++;
      return Promise.resolve({
        ok: true,
        json: async () => ({
          message: {
            content: JSON.stringify({
              category: 'document',
              tags: ['invoice', 'financial'],
              summary: 'Invoice #1042',
              suggested_folder: 'Invoices',
              confidence: 0.98,
            }),
          },
        }),
      });
    });

    try {
      const req = {
        filename: 'Invoice_1042.pdf',
        extension: '.pdf',
        sizeBytes: 45000,
        textExcerpt: 'Invoice total: $450.00',
      };

      const res1 = await service.classifyFile(req, 'qwen3-vl:8b');
      expect(res1.category).toBe('document');
      expect(callCount).toBe(1);

      // Second identical request should be served from memory cache without fetch
      const res2 = await service.classifyFile(req, 'qwen3-vl:8b');
      expect(res2.category).toBe('document');
      expect(res2.latencyMs).toBe(0);
      expect(callCount).toBe(1); // Still 1! Cache hit!
    } finally {
      global.fetch = originalFetch;
    }
  });

  // ── Natural Language Search Query Translation ─────────────────────────────

  it('translates natural language search query into structured search filters', () => {
    const rawOutput = JSON.stringify({
      text: 'Sony vacation',
      category: 'image',
      camera: 'Sony A7IV',
      dateFrom: '2024-01-01',
      dateTo: '2024-12-31',
      explanation: 'Extracted Sony camera and 2024 image parameters.',
    });

    const translated = service.parseAndValidateSearchQueryJson(rawOutput, 'photos taken with Sony in 2024');
    expect(translated.searchQuery.category).toBe('image');
    expect(translated.searchQuery.camera).toBe('Sony A7IV');
    expect(translated.searchQuery.dateFrom).toBe('2024-01-01');
    expect(translated.searchQuery.dateTo).toBe('2024-12-31');
    expect(translated.explanation).toContain('Sony');
  });

  it('gracefully falls back to original text search when LLM output is malformed', () => {
    const malformed = 'I cannot understand your query.';
    const translated = service.parseAndValidateSearchQueryJson(malformed, 'taxes 2023');
    expect(translated.searchQuery.text).toBe('taxes 2023');
    expect(translated.explanation).toContain('defaulted to text search');
  });
});
