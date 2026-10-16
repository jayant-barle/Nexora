// ============================================================================
// Unit Tests: AI Pipeline & Clustering Quality
// ============================================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { AiWorkerClient } from '../../src/main/ai-worker-client';

describe('AI Inference Worker & Vector Clustering', () => {
  let client: AiWorkerClient;
  let tempDir: string;

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexora-ai-test-'));
    client = new AiWorkerClient();
    await client.start();
  });

  afterAll(() => {
    client.stop();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it('responds to JSON-RPC ping with capabilities', async () => {
    const res = await client.ping();
    expect(res.pong).toBe(true);
    expect(typeof res.numpy).toBe('boolean');
  });

  it('clusters similar face embeddings into the same cluster', async () => {
    // Face A and Face A' (nearly identical), Face B (orthogonal)
    const embeddingA = [1.0, 0.0, 0.0, 0.0];
    const embeddingAPrime = [0.98, 0.02, 0.0, 0.0];
    const embeddingB = [0.0, 1.0, 0.0, 0.0];

    const clusters = await client.clusterFaces([embeddingA, embeddingAPrime, embeddingB], 0.2);
    expect(clusters).toHaveLength(3);
    // Face A and Face A' must be in the same cluster
    expect(clusters[0]).toBe(clusters[1]);
    // Face B must be in a distinct cluster
    expect(clusters[2]).not.toBe(clusters[0]);
  });

  it('separates distant face embeddings when threshold is strict', async () => {
    const face1 = [0.7, 0.7, 0.0, 0.0];
    const face2 = [0.7, -0.7, 0.0, 0.0];

    const clusters = await client.clusterFaces([face1, face2], 0.3);
    expect(clusters[0]).not.toBe(clusters[1]);
  });

  it('computes 64-char SHA-256 hash through Python worker', async () => {
    const sampleFile = path.join(tempDir, 'hash_test.txt');
    fs.writeFileSync(sampleFile, 'Hello Nexora AI PC File Manager', 'utf-8');

    const result = await client.computeHashes(sampleFile);
    expect(result.sha256).toHaveLength(64);
    expect(result.size_bytes).toBe(31);
  });

  it('extracts metadata and handles non-existent file with graceful error', async () => {
    await expect(client.extractMetadata('C:\\non_existent_file_path.jpg')).rejects.toThrow();
  });
});
