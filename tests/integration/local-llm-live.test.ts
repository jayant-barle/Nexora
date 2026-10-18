// ============================================================================
// Integration Test: Real Local Ollama Inference (when Ollama daemon is live)
// Tests: Live Ollama endpoint, model detection, JSON chat inference, schema validation
// ============================================================================

import { describe, it, expect } from 'vitest';
import { LocalLlmService } from '../../src/main/local-llm-service';

describe('Local Ollama Real Inference Integration Suite', () => {
  const service = new LocalLlmService({
    baseUrl: 'http://127.0.0.1:11434',
    timeoutMs: 90000,
  });

  it('queries live local Ollama status without crashing or remote requests', async () => {
    const status = await service.getStatus('qwen3:4b');
    expect(status.baseUrl).toBe('http://127.0.0.1:11434');
    // If Ollama is running locally, isAvailable is true
    if (status.isAvailable) {
      expect(Array.isArray(status.availableModels)).toBe(true);
      // Either model is present or correctly flagged as model_missing
      expect(['completed', 'model_missing']).toContain(status.state);
    } else {
      expect(status.state).toBe('unavailable');
    }
  });

  it('executes real inference against an installed local model if available', async () => {
    const status = await service.getStatus('llama3.2:1b');
    if (!status.isAvailable || !status.isModelReady) {
      // If local test environment doesn't have llama3.2:1b, gracefully pass
      console.log('Skipping live inference: llama3.2:1b not installed locally');
      return;
    }

    const result = await service.classifyFile(
      {
        filename: 'Quarterly_Tax_Statement_2025.pdf',
        extension: '.pdf',
        sizeBytes: 250000,
        textExcerpt: 'Internal Revenue statement of quarterly withholding and estimated corporate tax payments for fiscal year 2025.',
      },
      'llama3.2:1b'
    );

    expect(result.category).toBe('document');
    expect(result.confidence).toBeGreaterThan(0.5);
    expect(result.summary.length).toBeGreaterThan(10);
    expect(result.latencyMs).toBeGreaterThan(0);
    expect(result.modelUsed).toBe('llama3.2:1b');
  }, 40000);


  it('recommends safe organization plan using real local model without executing file changes', async () => {
    const status = await service.getStatus('llama3.2:1b');
    if (!status.isAvailable || !status.isModelReady) {
      console.log('Skipping live organize: llama3.2:1b not installed locally');
      return;
    }

    const proposal = await service.recommendOrganization(
      {
        filename: 'Contract_Elena_Vance_Final.docx',
        extension: '.docx',
        metadataSnapshot: {
          doc_author: 'Elena Vance',
          created_at: '2026-03-15T00:00:00Z',
        },
      },
      'llama3.2:1b'
    );

    expect(proposal.relativeFolder).toBeDefined();
    expect(proposal.relativeFolder).not.toContain('..');
    expect(proposal.relativeFolder).not.toMatch(/^[a-zA-Z]:/);
    expect(proposal.reasoning.length).toBeGreaterThan(5);
  }, 40000);
});
