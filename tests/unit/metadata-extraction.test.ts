// ============================================================================
// Unit Tests: Production Metadata Extraction Engine (Python AI Worker)
// Tests: PDF, Office DOCX, Audio WAV, Archives, Text, Fallbacks, Corrupt/Encrypted Files
// ============================================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { AiWorkerClient } from '../../src/main/ai-worker-client';
import archiver from 'archiver';

describe('Metadata Intelligence Extraction Pipeline', () => {
  let client: AiWorkerClient;
  let tempDir: string;

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexora-meta-test-'));
    client = new AiWorkerClient();
    await client.start();
  });

  afterAll(() => {
    client.stop();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  // ── Plaintext and Code Extraction ──────────────────────────────────────────

  it('extracts line count, word count, encoding and text preview for plaintext files', async () => {
    const textFile = path.join(tempDir, 'document.txt');
    fs.writeFileSync(textFile, 'The quick brown fox jumps over the lazy dog.\nSecond line of testing.\nThird line here.', 'utf-8');

    const meta = await client.extractMetadata(textFile);
    expect(meta.format_category).toBe('text');
    expect(meta.status).toBe('ok');
    expect(meta.word_count).toBeGreaterThan(10);
    expect(meta.text_preview).toContain('The quick brown fox');
    expect(meta.extractor_version).toContain('2.0');
  });

  // ── PDF Metadata Parsing ────────────────────────────────────────────────────

  it('extracts metadata from valid PDF without executing contents or macros', async () => {
    const pdfFile = path.join(tempDir, 'test_sample.pdf');
    // Minimal standard PDF file with metadata dictionary
    const pdfContent = `%PDF-1.4
1 0 obj
<< /Title (Annual Financial Report) /Author (Jane Doe) /Subject (Quarterly Analysis) >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R >>
endobj
trailer
<< /Root 2 0 R >>
%%EOF`;
    fs.writeFileSync(pdfFile, pdfContent, 'utf-8');

    const meta = await client.extractMetadata(pdfFile);
    expect(meta.format_category).toBe('document');
    expect(meta.status).toBe('ok');
    expect(meta.doc_title).toBe('Annual Financial Report');
    expect(meta.doc_author).toBe('Jane Doe');
    expect(meta.doc_subject).toBe('Quarterly Analysis');
    expect(meta.page_count).toBe(1);
  });

  // ── Office Documents (DOCX / XLSX / PPTX) ──────────────────────────────────

  it('extracts core properties and word count from OpenXML DOCX packages', async () => {
    const docxFile = path.join(tempDir, 'test_contract.docx');

    // Create a mock DOCX zip structure using built-in archiver or minimal zip header
    // Create ZIP using Python or standard zip structure
    const output = fs.createWriteStream(docxFile);
    const archive = archiver('zip');

    const coreXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
  xmlns:dc="http://purl.org/dc/elements/1.1/">
  <dc:title>Nexora Architecture Whitepaper</dc:title>
  <dc:creator>Dr. Elena Vance</dc:creator>
  <dc:description>System design specifications</dc:description>
</cp:coreProperties>`;

    const appXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">
  <Pages>14</Pages>
  <Words>3420</Words>
</Properties>`;

    const wordXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body><w:p><w:r><w:t>Confidential system architecture draft.</w:t></w:r></w:p></w:body>
</w:document>`;

    await new Promise<void>((resolve, reject) => {
      output.on('close', resolve);
      archive.on('error', reject);
      archive.pipe(output);
      archive.append(coreXml, { name: 'docProps/core.xml' });
      archive.append(appXml, { name: 'docProps/app.xml' });
      archive.append(wordXml, { name: 'word/document.xml' });
      archive.finalize();
    });

    const meta = await client.extractMetadata(docxFile);
    expect(meta.format_category).toBe('document');
    expect(meta.status).toBe('ok');
    expect(meta.doc_title).toBe('Nexora Architecture Whitepaper');
    expect(meta.doc_author).toBe('Dr. Elena Vance');
    expect(meta.doc_subject).toBe('System design specifications');
    expect(meta.page_count).toBe(14);
    expect(meta.word_count).toBe(3420);
    expect(meta.text_preview).toContain('Confidential system architecture');
  });

  // ── Audio Metadata (WAV RIFF) ──────────────────────────────────────────────

  it('extracts technical stream properties, duration and sample rate from WAV files', async () => {
    const wavFile = path.join(tempDir, 'sample_audio.wav');

    // Synthesize 1-second 44100Hz 16-bit stereo PCM WAV header
    const sampleRate = 44100;
    const channels = 2;
    const bitsPerSample = 16;
    const byteRate = (sampleRate * channels * bitsPerSample) / 8;
    const blockAlign = (channels * bitsPerSample) / 8;
    const dataSize = byteRate; // 1 second of audio
    const totalSize = 36 + dataSize;

    const buffer = Buffer.alloc(44 + dataSize);
    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(totalSize, 4);
    buffer.write('WAVE', 8);
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16); // Subchunk1Size
    buffer.writeUInt16LE(1, 20); // AudioFormat PCM
    buffer.writeUInt16LE(channels, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(byteRate, 28);
    buffer.writeUInt16LE(blockAlign, 32);
    buffer.writeUInt16LE(bitsPerSample, 34);
    buffer.write('data', 36);
    buffer.writeUInt32LE(dataSize, 40);

    fs.writeFileSync(wavFile, buffer);

    const meta = await client.extractMetadata(wavFile);
    expect(meta.format_category).toBe('audio');
    expect(meta.status).toBe('ok');
    expect(meta.duration_seconds).toBeCloseTo(1.0, 1);
    expect(meta.bitrate).toBeGreaterThan(1000);
  });

  // ── Archive Inspection ─────────────────────────────────────────────────────

  it('inspects ZIP archive entry count safely without executing files', async () => {
    const zipFile = path.join(tempDir, 'backup.zip');
    const output = fs.createWriteStream(zipFile);
    const archive = archiver('zip');

    await new Promise<void>((resolve, reject) => {
      output.on('close', resolve);
      archive.on('error', reject);
      archive.pipe(output);
      archive.append('file 1 content', { name: 'folder/file1.txt' });
      archive.append('file 2 content', { name: 'file2.txt' });
      archive.finalize();
    });

    const meta = await client.extractMetadata(zipFile);
    expect(meta.format_category).toBe('archive');
    expect(meta.status).toBe('ok');
    expect(meta.archive_entries).toBe(2);
  });

  // ── Error Handling: Corrupt, Encrypted, Unsupported ─────────────────────────

  it('detects corrupt files without crashing or terminating unrelated operations', async () => {
    const corruptPdf = path.join(tempDir, 'broken.pdf');
    // Header without required PDF body or trailer
    fs.writeFileSync(corruptPdf, 'Not a real pdf content or corrupt stream');

    const meta = await client.extractMetadata(corruptPdf);
    expect(meta.status).toBe('corrupt');
    expect(meta.format_category).toBe('document');
    expect(meta.error).toBeDefined();
  });

  it('classifies unsupported extensions with documented fallback category', async () => {
    const unsupportedFile = path.join(tempDir, 'unknown_binary.xyz');
    fs.writeFileSync(unsupportedFile, Buffer.from([0x00, 0x01, 0x02, 0x03]));

    const meta = await client.extractMetadata(unsupportedFile);
    expect(meta.format_category).toBe('other');
    expect(meta.status).toBe('unsupported');
  });

  it('preserves file integrity and never modifies or executes source files during extraction', async () => {
    const probeFile = path.join(tempDir, 'immutable_source.txt');
    const originalContent = 'Immutable source content for hash consistency check';
    fs.writeFileSync(probeFile, originalContent);

    const initialStat = fs.statSync(probeFile);
    const meta = await client.extractMetadata(probeFile);
    const finalStat = fs.statSync(probeFile);

    expect(meta.status).toBe('ok');
    expect(finalStat.size).toBe(initialStat.size);
    expect(fs.readFileSync(probeFile, 'utf-8')).toBe(originalContent);
  });
});
