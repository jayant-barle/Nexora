// ============================================================================
// Nexora — Offline AI Model Integrity & Manifest Unit Tests
// Verifies cryptographic hashes, local artifact presence, and zero-cloud guarantee
// ============================================================================

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

describe('Offline AI Model Integrity & Manifest Verification', () => {
  const modelsDir = path.join(__dirname, '..', '..', 'models');
  const manifestPath = path.join(modelsDir, 'manifest.json');

  it('contains an authoritative manifest.json with offline_ready guarantee', () => {
    expect(fs.existsSync(manifestPath)).toBe(true);
    const content = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

    expect(content.version).toBe('1.0.0');
    expect(content.offline_guarantee).toContain('100% On-Device Local Processing');
    expect(Array.isArray(content.models)).toBe(true);
    expect(content.models.length).toBeGreaterThanOrEqual(5);
  });

  it('bundles verified YuNet face detection model with matching SHA-256', () => {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    const yunetSpec = manifest.models.find((m: any) => m.task === 'face_detection');
    expect(yunetSpec).toBeDefined();

    const modelPath = path.join(modelsDir, yunetSpec.filename);
    expect(fs.existsSync(modelPath)).toBe(true);

    const fileBuffer = fs.readFileSync(modelPath);
    const actualHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
    expect(actualHash.toLowerCase()).toBe(yunetSpec.sha256.toLowerCase());
    expect(yunetSpec.license).toBe('MIT');
  });

  it('bundles verified SFace face recognition embedding model with matching SHA-256', () => {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    const sfaceSpec = manifest.models.find((m: any) => m.task === 'face_recognition');
    expect(sfaceSpec).toBeDefined();

    const modelPath = path.join(modelsDir, sfaceSpec.filename);
    expect(fs.existsSync(modelPath)).toBe(true);

    const fileBuffer = fs.readFileSync(modelPath);
    const actualHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
    expect(actualHash.toLowerCase()).toBe(sfaceSpec.sha256.toLowerCase());
    expect(sfaceSpec.license).toBe('Apache-2.0');
  });

  it('bundles verified MobileNetV2 image classification model with matching SHA-256', () => {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    const mobilenetSpec = manifest.models.find((m: any) => m.task === 'image_classification');
    expect(mobilenetSpec).toBeDefined();

    const modelPath = path.join(modelsDir, mobilenetSpec.filename);
    expect(fs.existsSync(modelPath)).toBe(true);

    const fileBuffer = fs.readFileSync(modelPath);
    const actualHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
    expect(actualHash.toLowerCase()).toBe(mobilenetSpec.sha256.toLowerCase());
    expect(mobilenetSpec.license).toBe('Apache-2.0');

    // Also verify ImageNet labels file exists
    const labelsPath = path.join(modelsDir, 'labels', 'imagenet_classes.txt');
    expect(fs.existsSync(labelsPath)).toBe(true);
    const labels = fs.readFileSync(labelsPath, 'utf-8').split('\n').filter(l => l.trim());
    expect(labels.length).toBe(1000);
  });

  it('bundles verified PP-OCRv3 text detector and CRNN recognizer with matching SHA-256', () => {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    const detSpec = manifest.models.find((m: any) => m.task === 'text_detection');
    const recSpec = manifest.models.find((m: any) => m.task === 'text_recognition');

    expect(detSpec).toBeDefined();
    expect(recSpec).toBeDefined();

    const detBuffer = fs.readFileSync(path.join(modelsDir, detSpec.filename));
    const detHash = crypto.createHash('sha256').update(detBuffer).digest('hex');
    expect(detHash.toLowerCase()).toBe(detSpec.sha256.toLowerCase());

    const recBuffer = fs.readFileSync(path.join(modelsDir, recSpec.filename));
    const recHash = crypto.createHash('sha256').update(recBuffer).digest('hex');
    expect(recHash.toLowerCase()).toBe(recSpec.sha256.toLowerCase());

    const alphaPath = path.join(modelsDir, 'labels', 'crnn_alphabet.txt');
    expect(fs.existsSync(alphaPath)).toBe(true);
  });

  it('confirms every bundled model is governed by a permissive open-source license', () => {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    const permissiveLicenses = ['MIT', 'Apache-2.0', 'BSD', 'BSD-3-Clause'];

    for (const m of manifest.models) {
      expect(permissiveLicenses).toContain(m.license);
      expect(m.offline_ready).toBe(true);
      expect(m.size_bytes).toBeGreaterThan(100000);
    }
  });
});
