// ============================================================================
// Nexora — Python AI Worker Client
// Manages Python subprocess lifecycle, JSON-RPC communication, and fault recovery
// ============================================================================

import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import { EventEmitter } from 'events';

export interface AiWorkerResponse<T = unknown> {
  id: string;
  status: 'ok' | 'error';
  result?: T;
  message?: string;
  traceback?: string;
}

export interface HashResult {
  sha256: string;
  md5: string;
  size_bytes: number;
  phash: string | null;
}

export interface MetadataResult {
  size_bytes: number;
  modified_at: number;
  created_at: number;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  capture_time: string | null;
  has_gps: boolean;
  latitude: number | null;
  longitude: number | null;
  altitude?: number | null;
  camera_make: string | null;
  camera_model: string | null;
  lens_model?: string | null;
  iso?: number | null;
  focal_length?: number | null;
  aperture?: number | null;
  exposure_time?: string | null;
  orientation?: number | null;
  codec?: string | null;
  frame_rate?: number | null;
  bitrate?: number | null;
  page_count?: number | null;
  word_count?: number | null;
  doc_title?: string | null;
  doc_author?: string | null;
  doc_subject?: string | null;
  text_preview?: string | null;
  audio_artist?: string | null;
  audio_album?: string | null;
  audio_title?: string | null;
  archive_entries?: number | null;
  format_category?: 'image' | 'video' | 'document' | 'audio' | 'archive' | 'text' | 'other';
  status?: 'ok' | 'unsupported' | 'corrupt' | 'encrypted';
  error?: string | null;
  extractor_version?: string;
}

export interface ThumbnailResult {
  success: boolean;
  thumbnail_path?: string;
  error?: string;
}

export interface FaceDetection {
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
  quality_score: number;
  embedding: number[];
}

export interface VideoObservation {
  timestamp_seconds: number;
  frame_number: number;
  faces: FaceDetection[];
}

export class AiWorkerClient extends EventEmitter {
  private process: ChildProcess | null = null;
  private pendingRequests: Map<string, { resolve: (val: any) => void; reject: (err: Error) => void; timer: NodeJS.Timeout }> = new Map();
  private stdoutBuffer = '';
  private isRestarting = false;
  private isExplicitlyStopped = false;
  private crashCount = 0;
  private lastCrashTime = 0;
  private scriptPath: string;
  private pythonPath: string;

  constructor() {
    super();
    // Resolve python worker script path
    const candidatePaths = [
      path.join(__dirname, '..', '..', 'ai-worker', 'src', 'main.py'),
      path.join(process.cwd(), 'ai-worker', 'src', 'main.py'),
    ];
    this.scriptPath = candidatePaths.find(p => fs.existsSync(p)) || candidatePaths[0];
    this.pythonPath = process.platform === 'win32' ? 'python' : 'python3';
  }

  public async start(): Promise<boolean> {
    this.isExplicitlyStopped = false;
    if (this.process && !this.process.killed) {
      return true;
    }

    if (!fs.existsSync(this.scriptPath)) {
      console.warn(`[AI-Worker] Script not found at ${this.scriptPath}. Operating in degraded mode.`);
      return false;
    }

    try {
      this.process = spawn(this.pythonPath, [this.scriptPath], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, PYTHONUNBUFFERED: '1' },
      });

      this.process.stdout?.setEncoding('utf-8');
      this.process.stdout?.on('data', (chunk: string) => this.handleStdout(chunk));

      this.process.stderr?.setEncoding('utf-8');
      this.process.stderr?.on('data', (data: string) => {
        console.warn(`[AI-Worker stderr] ${data.trim()}`);
      });

      this.process.on('error', (err) => {
        console.error('[AI-Worker] Process error:', err);
        this.emit('error', err);
      });

      this.process.on('exit', (code, signal) => {
        console.warn(`[AI-Worker] Process exited with code ${code}, signal ${signal}`);
        this.cleanupPending(new Error(`Worker exited prematurely with code ${code}`));
        this.handleCrash();
      });

      // Verify connection with ping
      const pingRes = await this.ping(5000);
      console.log('[AI-Worker] Connected successfully. Capabilities:', pingRes);
      this.emit('ready', pingRes);
      return true;
    } catch (err) {
      console.error('[AI-Worker] Failed to spawn Python worker:', err);
      return false;
    }
  }

  public stop(): void {
    this.isExplicitlyStopped = true;
    if (this.process) {
      this.process.stdin?.end();
      this.process.kill();
      this.process = null;
    }
    this.cleanupPending(new Error('AI Worker client stopped'));
  }

  private handleStdout(chunk: string): void {
    this.stdoutBuffer += chunk;
    const lines = this.stdoutBuffer.split('\n');
    // The last element is either an empty string or an incomplete line
    this.stdoutBuffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const response: AiWorkerResponse = JSON.parse(trimmed);
        if (response.id && this.pendingRequests.has(response.id)) {
          const { resolve, reject, timer } = this.pendingRequests.get(response.id)!;
          clearTimeout(timer);
          this.pendingRequests.delete(response.id);

          if (response.status === 'ok') {
            resolve(response.result);
          } else {
            const err = new Error(response.message || 'Worker error');
            (err as any).traceback = response.traceback;
            reject(err);
          }
        }
      } catch (e) {
        console.warn('[AI-Worker] Failed to parse JSON response:', trimmed, e);
      }
    }
  }

  private cleanupPending(error: Error): void {
    for (const [id, req] of this.pendingRequests.entries()) {
      clearTimeout(req.timer);
      req.reject(error);
    }
    this.pendingRequests.clear();
  }

  private handleCrash(): void {
    if (this.isExplicitlyStopped) return;
    const now = Date.now();
    if (now - this.lastCrashTime < 60000) {
      this.crashCount++;
    } else {
      this.crashCount = 1;
    }
    this.lastCrashTime = now;

    if (this.crashCount > 5) {
      console.error('[AI-Worker] Exceeded max crash limit (5 crashes within 60s). Disabling auto-restart.');
      this.emit('crashed-permanently');
      return;
    }

    if (!this.isRestarting) {
      this.isRestarting = true;
      const delay = Math.min(1000 * Math.pow(2, this.crashCount - 1), 10000);
      console.log(`[AI-Worker] Restarting worker in ${delay}ms...`);
      setTimeout(async () => {
        this.isRestarting = false;
        await this.start();
      }, delay);
    }
  }

  public async sendRequest<T = any>(action: string, params: Record<string, unknown> = {}, timeoutMs = 30000): Promise<T> {
    if (!this.process || this.process.killed) {
      const started = await this.start();
      if (!started) {
        throw new Error('AI Worker process is not running');
      }
    }

    const id = `req-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const payload = JSON.stringify({ id, action, params }) + '\n';

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`AI Worker request timed out after ${timeoutMs}ms (action: ${action})`));
        }
      }, timeoutMs);

      this.pendingRequests.set(id, { resolve, reject, timer });

      try {
        this.process!.stdin!.write(payload, 'utf-8', (err) => {
          if (err) {
            clearTimeout(timer);
            this.pendingRequests.delete(id);
            reject(err);
          }
        });
      } catch (err) {
        clearTimeout(timer);
        this.pendingRequests.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  // ─── High-Level Capabilities ───────────────────────────────────────────────

  public async ping(timeoutMs = 5000): Promise<{ pong: boolean; pil: boolean; numpy: boolean }> {
    return this.sendRequest('ping', {}, timeoutMs);
  }

  public async computeHashes(filePath: string): Promise<HashResult> {
    return this.sendRequest<HashResult>('compute_hashes', { file_path: filePath });
  }

  public async extractMetadata(filePath: string): Promise<MetadataResult> {
    return this.sendRequest<MetadataResult>('extract_metadata', { file_path: filePath });
  }

  public async generateThumbnail(filePath: string, outputPath: string, maxSize = 256): Promise<ThumbnailResult> {
    return this.sendRequest<ThumbnailResult>('generate_thumbnail', {
      file_path: filePath,
      output_path: outputPath,
      max_size: maxSize,
    });
  }

  public async detectFaces(filePath: string): Promise<FaceDetection[]> {
    return this.sendRequest<FaceDetection[]>('detect_faces', { file_path: filePath });
  }

  public async clusterFaces(embeddings: number[][], threshold = 0.6): Promise<number[]> {
    return this.sendRequest<number[]>('cluster_faces', { embeddings, threshold });
  }

  public async analyzeVideo(filePath: string, intervalSeconds = 5): Promise<VideoObservation[]> {
    return this.sendRequest<VideoObservation[]>('analyze_video', {
      file_path: filePath,
      interval_seconds: intervalSeconds,
    });
  }
}

// Singleton instance
let _client: AiWorkerClient | null = null;

export function getAiWorkerClient(): AiWorkerClient {
  if (!_client) {
    _client = new AiWorkerClient();
  }
  return _client;
}
