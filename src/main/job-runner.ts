// ============================================================================
// Nexora — Background Job Runner Engine
// Priority job queue, incremental workers, cancellation tokens, and progress telemetry
// ============================================================================

import { BrowserWindow } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import { getDb, updateJobStatus } from './database';
import { indexFolderIncremental } from './indexer';
import { executeBatchCopyOperation, CopyItem } from './file-operations';
import { getAiWorkerClient } from './ai-worker-client';

export class JobRunner {
  private isRunning = false;
  private isPaused = false;
  private activeJobId: string | null = null;
  private cancelledJobs: Set<string> = new Set();
  private pollTimer: NodeJS.Timeout | null = null;

  public start(): void {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => this.processNextJob(), 2000);
    // Process immediately
    this.processNextJob();
  }

  public stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  public pause(): void {
    this.isPaused = true;
  }

  public resume(): void {
    this.isPaused = false;
    this.processNextJob();
  }

  public cancel(jobId: string): void {
    this.cancelledJobs.add(jobId);
    updateJobStatus(jobId, 'cancelled');
    if (this.activeJobId === jobId) {
      this.notifyRenderer('job:cancelled', { jobId });
    }
  }

  private notifyRenderer(channel: string, payload: unknown): void {
    const windows = BrowserWindow.getAllWindows();
    for (const win of windows) {
      if (!win.isDestroyed()) {
        win.webContents.send(channel, payload);
      }
    }
  }

  private async processNextJob(): Promise<void> {
    if (this.isRunning || this.isPaused) return;

    const db = getDb();

    // Query highest priority queued job
    const job = db.prepare(`
      SELECT * FROM jobs
      WHERE status = 'queued'
      ORDER BY priority ASC, created_at ASC
      LIMIT 1
    `).get() as any;

    if (!job) return;

    this.isRunning = true;
    this.activeJobId = job.id;

    updateJobStatus(job.id, 'running');
    this.notifyRenderer('job:progress', { jobId: job.id, status: 'running', progress: 0, total: 100 });

    try {
      if (job.type === 'folder_scan' || job.type === 'index_folder') {
        await this.handleFolderScanJob(job);
      } else if (job.type === 'batch_copy') {
        await this.handleBatchCopyJob(job);
      } else if (job.type === 'face_clustering') {
        await this.handleFaceClusteringJob(job);
      } else {
        console.warn(`[JobRunner] Unknown job type: ${job.type}`);
        updateJobStatus(job.id, 'completed', 100, 100);
      }

      if (this.cancelledJobs.has(job.id)) {
        updateJobStatus(job.id, 'cancelled');
        this.notifyRenderer('job:progress', { jobId: job.id, status: 'cancelled' });
      } else {
        updateJobStatus(job.id, 'completed', 100, 100);
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
      if (job.retry_count < job.max_retries) {
        db.prepare(`
          UPDATE jobs SET status = 'queued', retry_count = retry_count + 1, error_message = ? WHERE id = ?
        `).run(errorMsg, job.id);
      } else {
        updateJobStatus(job.id, 'failed', job.progress, job.total, errorMsg);
        this.notifyRenderer('job:error', { jobId: job.id, error: errorMsg });
      }
    } finally {
      this.cancelledJobs.delete(job.id);
      this.activeJobId = null;
      this.isRunning = false;
      // Immediately check for more jobs in queue
      setTimeout(() => this.processNextJob(), 100);
    }
  }

  // ─── Job Type Handlers ───────────────────────────────────────────────────────

  private async handleFolderScanJob(job: any): Promise<void> {
    const targetFolder = job.target_path;
    if (!targetFolder) {
      throw new Error('Folder scan job requires a target_path');
    }

    await indexFolderIncremental(targetFolder, {
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

  private async handleFaceClusteringJob(job: any): Promise<void> {
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
}

// Singleton runner
let _runner: JobRunner | null = null;

export function getJobRunner(): JobRunner {
  if (!_runner) {
    _runner = new JobRunner();
  }
  return _runner;
}
