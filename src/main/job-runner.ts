// ============================================================================
// Nexora — Background Job Runner Engine
// Priority job queue, adaptive bounded concurrency, cancellation, and recovery
// ============================================================================

import { BrowserWindow } from 'electron';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { getDb, updateJobStatus, getSettings, retryJob, clearCompletedJobs } from './database';
import { indexFolderIncremental, recalculateDuplicates } from './indexer';
import { executeBatchCopyOperation, CopyItem } from './file-operations';
import { getAiWorkerClient } from './ai-worker-client';
import { getHardwareMonitor } from './hardware-monitor';
import type { JobQueueStats, ResourceProfile } from '../shared/types';

export class JobRunner {
  private activeJobs: Set<string> = new Set();
  private isPaused = false;
  private cancelledJobs: Set<string> = new Set();
  private pollTimer: NodeJS.Timeout | null = null;
  private completedRecentTimestamps: number[] = [];

  public recoverStrandedJobs(): void {
    try {
      const db = getDb();
      db.prepare(`
        UPDATE jobs
        SET status = 'queued', updated_at = datetime('now')
        WHERE status = 'running'
      `).run();
    } catch {}
  }

  public start(): void {
    if (this.pollTimer) return;

    // Recover any stranded running jobs from an ungraceful shutdown/restart
    this.recoverStrandedJobs();

    this.pollTimer = setInterval(() => this.processNextJobs(), 1500);
    // Process immediately
    this.processNextJobs();
  }

  public stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  public pause(): void {
    this.isPaused = true;
    this.notifyRenderer('queue:status-changed', this.getQueueStats());
  }

  public pauseAll(): void {
    this.pause();
  }

  public resume(): void {
    this.isPaused = false;
    this.notifyRenderer('queue:status-changed', this.getQueueStats());
    this.processNextJobs();
  }

  public resumeAll(): void {
    this.resume();
  }

  public cancel(jobId: string): void {
    this.cancelledJobs.add(jobId);
    updateJobStatus(jobId, 'cancelled');
    this.activeJobs.delete(jobId);
    this.notifyRenderer('job:cancelled', { jobId });
    this.notifyRenderer('queue:status-changed', this.getQueueStats());
  }

  public retry(jobId: string): boolean {
    const job = retryJob(jobId);
    if (!job) return false;
    this.cancelledJobs.delete(jobId);
    this.notifyRenderer('job:progress', { jobId, status: 'queued', progress: 0, total: job.total || 0 });
    this.notifyRenderer('queue:status-changed', this.getQueueStats());
    setImmediate(() => this.processNextJobs());
    return true;
  }

  public clearCompleted(): number {
    const removedCount = clearCompletedJobs();
    this.notifyRenderer('queue:status-changed', this.getQueueStats());
    return removedCount;
  }

  public getQueueStats(): JobQueueStats {
    try {
      const db = getDb();
      const rows = db.prepare(`
        SELECT status, COUNT(*) as count FROM jobs GROUP BY status
      `).all() as Array<{ status: string; count: number }>;
      const counts: Record<string, number> = {};
      for (const r of rows) counts[r.status] = r.count;

      let pendingAiFiles = 0;
      try {
        const pendingRow = db.prepare("SELECT COUNT(*) as count FROM files WHERE processing_status = 'pending'").get() as any;
        pendingAiFiles = pendingRow?.count || 0;
      } catch {}

      const settings = getSettings();
      const runAiOnlyWhenIdle = settings.runAiOnlyWhenIdle === 'true';
      const monitor = getHardwareMonitor();
      const metrics = monitor.getHardwareMetrics();
      const isWaitingForIdle = runAiOnlyWhenIdle && (metrics.cpuLoadPercent >= 35 || metrics.memoryPressurePercent >= 75);
      const now = Date.now();
      this.completedRecentTimestamps = this.completedRecentTimestamps.filter(t => now - t <= 10000);
      const processingRatePerSec = this.completedRecentTimestamps.length > 0 ? this.completedRecentTimestamps.length / 10 : 0;

      return {
        activeJobs: this.activeJobs.size,
        queuedJobs: counts['queued'] || 0,
        pausedJobs: counts['paused'] || 0,
        failedJobs: counts['failed'] || 0,
        completedJobs: counts['completed'] || 0,
        pendingAiFiles,
        isPaused: this.isPaused,
        isWaitingForIdle,
        processingRatePerSec,
      };
    } catch {
      return {
        activeJobs: this.activeJobs.size,
        queuedJobs: 0,
        pausedJobs: 0,
        failedJobs: 0,
        completedJobs: 0,
        pendingAiFiles: 0,
        isPaused: this.isPaused,
        isWaitingForIdle: false,
        processingRatePerSec: 0,
      };
    }
  }

  private notifyRenderer(channel: string, payload: unknown): void {
    try {
      const windows = BrowserWindow.getAllWindows();
      for (const win of windows) {
        if (!win.isDestroyed()) {
          win.webContents.send(channel, payload);
        }
      }
    } catch {}
  }

  private async processNextJobs(): Promise<void> {
    if (this.isPaused) return;

    const settings = getSettings();
    const configuredProfile = (settings.resourceProfile as ResourceProfile) || 'auto';
    const monitor = getHardwareMonitor();
    const executionParams = monitor.getExecutionParams(configuredProfile);
    const maxConcurrency = executionParams.maxConcurrentJobs;

    // Fill concurrency slots up to allowed limit
    while (this.activeJobs.size < maxConcurrency && !this.isPaused) {
      const metrics = monitor.getHardwareMetrics(configuredProfile);
      const allowAi = settings.enableBackgroundAi !== 'false' && executionParams.allowBackgroundAi;
      const runAiOnlyWhenIdle = settings.runAiOnlyWhenIdle === 'true';
      const isSystemIdle = metrics.cpuLoadPercent < 35 && metrics.memoryPressurePercent < 75;

      const db = getDb();

      // Priority bands:
      // Priority 1 (Interactive) -> Priority 2 (Lightweight Index) -> Priority 3 (Enrichment) -> Priority 4 (Heavy AI)
      let priorityFilter = '';
      if (!allowAi || (runAiOnlyWhenIdle && !isSystemIdle) || executionParams.isThrottled) {
        // Under resource pressure or idle-only constraint, filter out heavy Priority 4 AI jobs
        priorityFilter = 'AND priority < 4 AND type NOT IN (\'face_clustering\', \'face_detection\', \'face_detect\', \'video_analyze\')';
      }

      // Query highest priority queued job; aging-friendly (ordered by priority ASC, created_at ASC)
      const job = db.prepare(`
        SELECT * FROM jobs
        WHERE status = 'queued' ${priorityFilter}
        ORDER BY priority ASC, created_at ASC
        LIMIT 1
      `).get() as any;

      if (!job) break;

      this.activeJobs.add(job.id);
      updateJobStatus(job.id, 'running');
      this.notifyRenderer('job:progress', { jobId: job.id, status: 'running', progress: 0, total: 100 });
      this.notifyRenderer('queue:status-changed', this.getQueueStats());

      // Execute asynchronously in background slot
      this.executeJob(job, executionParams);
    }
  }

  private async executeJob(job: any, executionParams: any): Promise<void> {
    const db = getDb();
    try {
      if (job.type === 'folder_scan' || job.type === 'index_folder') {
        await this.handleFolderScanJob(job, executionParams);
      } else if (job.type === 'batch_copy') {
        await this.handleBatchCopyJob(job);
      } else if (job.type === 'face_clustering') {
        await this.handleFaceClusteringJob(job);
      } else if (job.type === 'face_detect') {
        await this.handleFaceDetectJob(job);
      } else if (job.type === 'video_analyze') {
        await this.handleVideoAnalyzeJob(job);
      } else if (job.type === 'hash_compute' || job.type === 'duplicate_compare') {
        await this.handleHashComputeJob(job);
      } else {
        console.warn(`[JobRunner] Unknown job type: ${job.type}`);
        updateJobStatus(job.id, 'completed', 100, 100);
      }

      if (this.cancelledJobs.has(job.id)) {
        updateJobStatus(job.id, 'cancelled');
        this.notifyRenderer('job:progress', { jobId: job.id, status: 'cancelled' });
      } else {
        updateJobStatus(job.id, 'completed', 100, 100);
        this.completedRecentTimestamps.push(Date.now());
        this.notifyRenderer('job:completed', { jobId: job.id, status: 'completed' });
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[JobRunner] Job ${job.id} failed:`, errorMsg);

      // Record in job_errors table
      try {
        db.prepare(`
          INSERT INTO job_errors (id, job_id, error_type, error_message, created_at)
          VALUES (?, ?, 'execution_error', ?, datetime('now'))
        `).run(uuidv4(), job.id, errorMsg);
      } catch {}

      // Retry policy
      if (job.retry_count < (job.max_retries || 3)) {
        db.prepare(`
          UPDATE jobs SET status = 'queued', retry_count = retry_count + 1, error_message = ? WHERE id = ?
        `).run(errorMsg, job.id);
      } else {
        updateJobStatus(job.id, 'failed', job.progress, job.total, errorMsg);
        this.notifyRenderer('job:error', { jobId: job.id, error: errorMsg });
      }
    } finally {
      this.cancelledJobs.delete(job.id);
      this.activeJobs.delete(job.id);
      this.notifyRenderer('queue:status-changed', this.getQueueStats());
      // Prompt next job pickup immediately
      setImmediate(() => this.processNextJobs());
    }
  }

  // ─── Job Type Handlers ───────────────────────────────────────────────────────

  private async handleFolderScanJob(job: any, executionParams: any): Promise<void> {
    const targetFolder = job.target_path;
    if (!targetFolder) {
      throw new Error('Folder scan job requires a target_path');
    }

    const config = job.config_json ? JSON.parse(job.config_json) : {};

    await indexFolderIncremental(targetFolder, {
      extractAi: config.extractAi !== undefined ? config.extractAi : executionParams.allowBackgroundAi,
      generateThumbnails: config.generateThumbnails !== false,
      videoSamplingInterval: executionParams.videoSamplingIntervalSeconds,
      isCancelled: () => this.cancelledJobs.has(job.id),
      onProgress: (processed, total, currentFile) => {
        const percent = total > 0 ? Math.round((processed / total) * 100) : 0;
        updateJobStatus(job.id, 'running', processed, total);
        this.notifyRenderer('job:progress', {
          jobId: job.id,
          status: 'running',
          progress: processed,
          total,
          percent,
          currentFile,
        });
      },
    });
  }

  private async handleBatchCopyJob(job: any): Promise<void> {
    const config = job.config_json ? JSON.parse(job.config_json) : {};
    const items: CopyItem[] = config.items || [];
    const destinationRoot: string = config.destinationRoot || job.target_path;

    if (!destinationRoot || items.length === 0) {
      throw new Error('Batch copy job requires destinationRoot and items array');
    }

    await executeBatchCopyOperation(
      config.sourceDescription || 'Batch copy',
      destinationRoot,
      items,
      (completed, total) => {
        const percent = Math.round((completed / total) * 100);
        updateJobStatus(job.id, 'running', completed, total);
        this.notifyRenderer('job:progress', {
          jobId: job.id,
          status: 'running',
          progress: completed,
          total,
          percent,
        });
      }
    );
  }

  private async handleFaceClusteringJob(_job: any): Promise<void> {
    const db = getDb();
    const aiClient = getAiWorkerClient();

    // Query all unclustered face detections with valid embeddings
    const faces = db.prepare(`
      SELECT fd.id, fd.file_id, fd.embedding
      FROM face_detections fd
      WHERE fd.embedding IS NOT NULL
      ORDER BY fd.created_at ASC
    `).all() as Array<{ id: string; file_id: string; embedding: Buffer }>;

    if (faces.length === 0) return;

    // Convert Buffers back to Float32 arrays
    const embeddings: number[][] = [];
    const faceIds: string[] = [];

    for (const f of faces) {
      try {
        const floatArray = Array.from(new Float32Array(f.embedding.buffer, f.embedding.byteOffset, f.embedding.byteLength / 4));
        if (floatArray.length > 0) {
          embeddings.push(floatArray);
          faceIds.push(f.id);
        }
      } catch {}
    }

    if (embeddings.length === 0) return;

    const clusterIds = await aiClient.clusterFaces(embeddings, 0.6);

    // Group detections by cluster ID
    const clusterMap = new Map<number, string[]>();
    for (let i = 0; i < clusterIds.length; i++) {
      const cid = clusterIds[i];
      if (!clusterMap.has(cid)) clusterMap.set(cid, []);
      clusterMap.get(cid)!.push(faceIds[i]);
    }

    // Persist clusters and cluster members in transaction
    const executeClusterPersist = db.transaction(() => {
      const insertClusterStmt = db.prepare(`
        INSERT INTO face_clusters (id, person_id, member_count, avg_confidence, created_at, updated_at)
        VALUES (?, ?, ?, 0.85, datetime('now'), datetime('now'))
      `);

      const insertMemberStmt = db.prepare(`
        INSERT OR IGNORE INTO cluster_members (cluster_id, face_detection_id, distance, added_at)
        VALUES (?, ?, 0.1, datetime('now'))
      `);

      const insertPersonStmt = db.prepare(`
        INSERT INTO people (id, name, representative_face_id, review_status, created_at, updated_at)
        VALUES (?, ?, ?, 'unreviewed', datetime('now'), datetime('now'))
      `);

      const insertFilePersonStmt = db.prepare(`
        INSERT OR IGNORE INTO file_people (file_id, person_id, association_type)
        VALUES (?, ?, 'auto')
      `);

      for (const [cid, members] of clusterMap.entries()) {
        const clusterUuid = uuidv4();
        const personId = uuidv4();
        const representativeFaceId = members[0];

        // Create Person record (unreviewed)
        insertPersonStmt.run(personId, `Person ${cid + 1}`, representativeFaceId);
        insertClusterStmt.run(clusterUuid, personId, members.length);

        for (const faceId of members) {
          insertMemberStmt.run(clusterUuid, faceId);
          // Link file to person
          const faceRecord = faces.find(f => f.id === faceId);
          if (faceRecord) {
            insertFilePersonStmt.run(faceRecord.file_id, personId);
          }
        }
      }
    });

    executeClusterPersist();
  }

  private async handleFaceDetectJob(job: any): Promise<void> {
    const db = getDb();
    const filePath = job.target_path;
    const fileId = job.target_id;

    if (!filePath || !fileId || !fs.existsSync(filePath)) {
      throw new Error(`File not found for face detection: ${filePath}`);
    }

    // Recheck source file identity and modification state before committing results
    const fileRecord = db.prepare('SELECT id, file_modified_at, size_bytes FROM files WHERE id = ?').get(fileId) as any;
    if (!fileRecord) {
      throw new Error(`File record not found in database: ${fileId}`);
    }

    const stat = fs.statSync(filePath);
    if (stat.size !== fileRecord.size_bytes || stat.mtime.toISOString() !== fileRecord.file_modified_at) {
      throw new Error(`Source file was modified in-flight before face detection: ${filePath}`);
    }

    const aiClient = getAiWorkerClient();
    const detections = await aiClient.detectFaces(filePath);

    const insertFaceTx = db.transaction(() => {
      const insertFaceStmt = db.prepare(`
        INSERT OR IGNORE INTO face_detections (
          id, file_id, x, y, width, height, confidence, quality_score, embedding, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `);

      for (const d of detections) {
        insertFaceStmt.run(
          uuidv4(),
          fileId,
          d.x,
          d.y,
          d.width,
          d.height,
          d.confidence,
          d.quality_score,
          Buffer.from(new Float32Array(d.embedding).buffer)
        );
      }

      db.prepare(`
        UPDATE files
        SET processing_status = 'completed', updated_at = datetime('now')
        WHERE id = ?
      `).run(fileId);
    });

    insertFaceTx();
  }

  private async handleVideoAnalyzeJob(job: any): Promise<void> {
    const db = getDb();
    const filePath = job.target_path;
    const fileId = job.target_id;

    if (!filePath || !fileId || !fs.existsSync(filePath)) {
      throw new Error(`Video file not found for analysis: ${filePath}`);
    }

    const fileRecord = db.prepare('SELECT id, file_modified_at, size_bytes FROM files WHERE id = ?').get(fileId) as any;
    if (!fileRecord) {
      throw new Error(`Video file record not found: ${fileId}`);
    }

    const stat = fs.statSync(filePath);
    if (stat.size !== fileRecord.size_bytes || stat.mtime.toISOString() !== fileRecord.file_modified_at) {
      throw new Error(`Video file was modified in-flight before analysis: ${filePath}`);
    }

    const config = job.config_json ? JSON.parse(job.config_json) : {};
    const intervalSeconds = config.intervalSeconds || 5;

    const aiClient = getAiWorkerClient();
    const observations = await aiClient.analyzeVideo(filePath, intervalSeconds);

    const insertVideoTx = db.transaction(() => {
      const insertFaceStmt = db.prepare(`
        INSERT OR IGNORE INTO face_detections (
          id, file_id, x, y, width, height, confidence, quality_score, embedding, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `);

      const insertObsStmt = db.prepare(`
        INSERT OR IGNORE INTO video_observations (
          id, file_id, face_detection_id, timestamp_seconds, frame_number, created_at
        ) VALUES (?, ?, ?, ?, ?, datetime('now'))
      `);

      for (const obs of observations) {
        for (const face of obs.faces) {
          const faceId = uuidv4();
          insertFaceStmt.run(
            faceId,
            fileId,
            face.x,
            face.y,
            face.width,
            face.height,
            face.confidence,
            face.quality_score,
            Buffer.from(new Float32Array(face.embedding).buffer)
          );

          insertObsStmt.run(
            uuidv4(),
            fileId,
            faceId,
            obs.timestamp_seconds,
            obs.frame_number
          );
        }
      }

      db.prepare(`
        UPDATE files
        SET processing_status = 'completed', updated_at = datetime('now')
        WHERE id = ?
      `).run(fileId);
    });

    insertVideoTx();
  }

  private async handleHashComputeJob(job: any): Promise<void> {
    updateJobStatus(job.id, 'running', 20, 100);
    this.notifyRenderer('job:progress', { jobId: job.id, status: 'running', progress: 20, total: 100 });

    // Recalculate duplicate groups and visual similarity
    recalculateDuplicates();

    updateJobStatus(job.id, 'running', 100, 100);
    this.notifyRenderer('job:progress', { jobId: job.id, status: 'running', progress: 100, total: 100 });
  }
}

// Singleton runner
let _runner: JobRunner | null = null;

export function getJobRunner(): JobRunner {
  if (!_runner) {
    _runner = new JobRunner();
  }
  return _runner;
}
