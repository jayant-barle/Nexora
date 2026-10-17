// ============================================================================
// Nexora — Incremental Indexing Engine
// Scans folders, reuses cached metadata, extracts AI features, and indexes FTS5
// ============================================================================

import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { app } from 'electron';
import { getDb, getSettings, updateRootScanStatus } from './database';
import { getAiWorkerClient } from './ai-worker-client';
import { getHardwareMonitor } from './hardware-monitor';
import { getMimeType, isImageFile, isVideoFile, computeFileHashStream, validateSafePath } from './filesystem';

export type ScanStage = 'discovery' | 'metadata' | 'hashing' | 'deduplication' | 'reconciliation';

export interface ScanOptions {
  recursive?: boolean;
  extractAi?: boolean;
  generateThumbnails?: boolean;
  forceFullRescan?: boolean;
  videoSamplingInterval?: number;
  onStageChange?: (stage: ScanStage) => void;
  onProgress?: (processed: number, total: number, currentFile: string) => void;
  isCancelled?: () => boolean;
}

export interface ScanResult {
  rootId: string;
  totalFound: number;
  indexedNew: number;
  updatedExisting: number;
  reusedCached: number;
  failedCount: number;
  durationMs: number;
}

// ─── Thumbnail Cache Directory ───────────────────────────────────────────────

function getThumbnailCacheDir(): string {
  const userData = app?.getPath ? app.getPath('userData') : path.join(process.cwd(), '.data');
  const thumbDir = path.join(userData, 'thumbnails');
  if (!fs.existsSync(thumbDir)) {
    fs.mkdirSync(thumbDir, { recursive: true });
  }
  return thumbDir;
}

// ─── Directory Tree Discovery ────────────────────────────────────────────────

export function collectFilesRecursively(
  dirPath: string,
  excludePatterns: string[] = ['.git', 'node_modules', '$RECYCLE.BIN', 'System Volume Information', '.thumbnails', 'thumbnails', '.cache', 'Nexora_Organized'],
  isCancelled?: () => boolean,
  visitedRealPaths: Set<string> = new Set<string>()
): string[] {
  const filePaths: string[] = [];

  function walk(currentDir: string) {
    if (isCancelled && isCancelled()) return;

    // Detect and prevent symlink / junction recursion cycles via real canonical path
    let realCurrentDir: string;
    try {
      realCurrentDir = fs.realpathSync(currentDir);
    } catch {
      return; // Skip broken or inaccessible path
    }

    if (visitedRealPaths.has(realCurrentDir)) {
      return; // Cycle detected: skip to prevent infinite recursion loop
    }
    visitedRealPaths.add(realCurrentDir);

    // Skip Nexora-managed output directories (explicit marker or naming pattern)
    try {
      if (fs.existsSync(path.join(currentDir, '.nexora-managed'))) {
        return;
      }
    } catch {}

    const curBaseLower = path.basename(currentDir).toLowerCase();
    if (curBaseLower.startsWith('nexora_organized') || curBaseLower.endsWith('_nexora_organized') || curBaseLower.includes('nexora organized') || curBaseLower.includes('nexora_organized')) {
      return;
    }

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return; // Skip inaccessible directories (e.g. EPERM, EACCES)
    }

    for (const entry of entries) {
      if (isCancelled && isCancelled()) return;

      const fullPath = path.join(currentDir, entry.name);
      const lowerName = entry.name.toLowerCase();

      // Check exclude patterns
      if (excludePatterns.some(p => lowerName === p.toLowerCase() || lowerName.includes(p.toLowerCase()))) {
        continue;
      }
      if (lowerName.startsWith('nexora_organized') || lowerName.endsWith('_nexora_organized') || lowerName.includes('nexora organized') || lowerName.includes('nexora_organized')) {
        continue;
      }

      try {
        if (entry.isDirectory()) {
          walk(fullPath);
        } else if (entry.isSymbolicLink()) {
          try {
            const stat = fs.statSync(fullPath);
            if (stat.isDirectory()) {
              walk(fullPath);
            } else if (stat.isFile()) {
              filePaths.push(fullPath);
            }
          } catch {
            // Inaccessible symlink target
          }
        } else if (entry.isFile()) {
          filePaths.push(fullPath);
        }
      } catch {
        // Skip inaccessible entries
      }
    }
  }

  walk(dirPath);
  return filePaths;
}

// ─── Incremental Scan & Index Worker ─────────────────────────────────────────

export async function indexFolderIncremental(
  targetFolder: string,
  options: ScanOptions = {}
): Promise<ScanResult> {
  const startTime = Date.now();
  const db = getDb();
  const aiClient = getAiWorkerClient();
  const thumbDir = getThumbnailCacheDir();

  const normalizedRoot = path.normalize(targetFolder);

  // Validate target path exists and is accessible
  try {
    const stat = fs.statSync(normalizedRoot);
    if (!stat.isDirectory()) {
      throw new Error(`Target path is not a directory: ${normalizedRoot}`);
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    try {
      const existingRoot = db.prepare('SELECT id FROM roots WHERE path = ?').get(normalizedRoot) as any;
      if (existingRoot) {
        updateRootScanStatus(existingRoot.id, 'error', undefined, undefined, errMsg);
      }
    } catch {}
    throw new Error(`Target directory is not accessible: ${normalizedRoot} (${errMsg})`);
  }

  // 1. Ensure Root Record exists in database
  let root = db.prepare('SELECT * FROM roots WHERE path = ?').get(normalizedRoot) as any;
  if (!root) {
    const rootId = uuidv4();
    const label = path.basename(normalizedRoot) || normalizedRoot;
    db.prepare(`
      INSERT INTO roots (id, path, label, type, active, scan_status, file_count, total_size_bytes, created_at, updated_at)
      VALUES (?, ?, ?, 'indexed', 1, 'scanning', 0, 0, datetime('now'), datetime('now'))
    `).run(rootId, normalizedRoot, label);
    root = { id: rootId, path: normalizedRoot, label };
  } else {
    try {
      updateRootScanStatus(root.id, 'scanning');
    } catch {}
  }
  const rootId = root.id;

  // 2. Discover all files
  if (options.onStageChange) {
    options.onStageChange('discovery');
  }
  const filePaths = collectFilesRecursively(normalizedRoot, undefined, options.isCancelled);
  const totalFound = filePaths.length;

  let indexedNew = 0;
  let updatedExisting = 0;
  let reusedCached = 0;
  let failedCount = 0;

  // Pre-load existing indexed files for this root for O(1) in-memory comparison
  const existingRows = db.prepare(`
    SELECT id, relative_path, size_bytes, file_modified_at, hash_sha256, thumbnail_path, fingerprint
    FROM files WHERE root_id = ?
  `).all(rootId) as Array<{
    id: string;
    relative_path: string;
    size_bytes: number;
    file_modified_at: string;
    hash_sha256: string | null;
    thumbnail_path: string | null;
    fingerprint?: string | null;
  }>;

  const existingMap = new Map<string, typeof existingRows[0]>();
  for (const row of existingRows) {
    existingMap.set(row.relative_path, row);
  }

  // Prepared Statements
  const insertFileStmt = db.prepare(`
    INSERT INTO files (
      id, root_id, relative_path, filename, extension, mime_type, size_bytes, hash_sha256,
      width, height, duration_seconds, capture_time, file_created_at, file_modified_at,
      has_gps, latitude, longitude, thumbnail_path, metadata_json, processing_status,
      camera_make, camera_model, lens_model, iso, focal_length, aperture, exposure_time, orientation,
      codec, frame_rate, bitrate, page_count, word_count,
      doc_title, doc_author, doc_subject,
      audio_artist, audio_album, audio_title, archive_entries,
      color_profile, fingerprint,
      is_missing, availability_status, extractor_version, extracted_at, last_scanned_at
    ) VALUES (
      @id, @root_id, @relative_path, @filename, @extension, @mime_type, @size_bytes, @hash_sha256,
      @width, @height, @duration_seconds, @capture_time, @file_created_at, @file_modified_at,
      @has_gps, @latitude, @longitude, @thumbnail_path, @metadata_json, @processing_status,
      @camera_make, @camera_model, @lens_model, @iso, @focal_length, @aperture, @exposure_time, @orientation,
      @codec, @frame_rate, @bitrate, @page_count, @word_count,
      @doc_title, @doc_author, @doc_subject,
      @audio_artist, @audio_album, @audio_title, @archive_entries,
      @color_profile, @fingerprint,
      0, @availability_status, @extractor_version, datetime('now'), datetime('now')
    )
  `);

  const updateFileStmt = db.prepare(`
    UPDATE files SET
      size_bytes = @size_bytes, hash_sha256 = @hash_sha256, width = @width, height = @height,
      duration_seconds = @duration_seconds, capture_time = @capture_time,
      file_modified_at = @file_modified_at, has_gps = @has_gps, latitude = @latitude, longitude = @longitude,
      thumbnail_path = @thumbnail_path, metadata_json = @metadata_json, processing_status = @processing_status,
      camera_make = @camera_make, camera_model = @camera_model, lens_model = @lens_model, iso = @iso,
      focal_length = @focal_length, aperture = @aperture, exposure_time = @exposure_time, orientation = @orientation,
      codec = @codec, frame_rate = @frame_rate, bitrate = @bitrate, page_count = @page_count, word_count = @word_count,
      doc_title = @doc_title, doc_author = @doc_author, doc_subject = @doc_subject,
      audio_artist = @audio_artist, audio_album = @audio_album, audio_title = @audio_title,
      archive_entries = @archive_entries, color_profile = @color_profile, fingerprint = @fingerprint,
      is_missing = 0, availability_status = @availability_status,
      extractor_version = @extractor_version, extracted_at = datetime('now'), last_scanned_at = datetime('now'),
      updated_at = datetime('now')
    WHERE id = @id
  `);

  const touchLastScannedStmt = db.prepare(`
    UPDATE files SET last_scanned_at = datetime('now'), is_missing = 0, availability_status = 'available' WHERE id = ?
  `);

  // FTS5 index sync statements
  const insertFtsStmt = db.prepare(`
    INSERT INTO search_index (file_id, filename, path, tags, ocr_text, metadata)
    VALUES (?, ?, ?, '', '', ?)
  `);

  const deleteFtsStmt = db.prepare(`
    DELETE FROM search_index WHERE file_id = ?
  `);

  const insertFaceStmt = db.prepare(`
    INSERT INTO face_detections (
      id, file_id, x, y, width, height, confidence, quality_score, embedding, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `);

  const enqueueJobStmt = db.prepare(`
    INSERT OR IGNORE INTO jobs (
      id, type, status, priority, progress, total, target_path, target_id, config_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `);

  // Adaptive batch transaction helper
  const settings = getSettings();
  const configuredProfile = (settings.resourceProfile as any) || 'auto';
  const executionParams = getHardwareMonitor().getExecutionParams(configuredProfile);
  const BATCH_SIZE = executionParams.batchSize;
  let pendingBatch: Array<() => void> = [];

  function commitBatch() {
    if (pendingBatch.length === 0) return;
    const runBatch = db.transaction((ops: Array<() => void>) => {
      for (const op of ops) op();
    });
    runBatch(pendingBatch);
    pendingBatch = [];
  }

  // 3. Process each file
  if (options.onStageChange) {
    options.onStageChange('metadata');
  }

  for (let i = 0; i < filePaths.length; i++) {
    if (options.isCancelled && options.isCancelled()) {
      break;
    }

    const fullPath = filePaths[i];
    const relativePath = path.relative(normalizedRoot, fullPath);
    const filename = path.basename(fullPath);
    const ext = path.extname(fullPath).toLowerCase();
    const mime = getMimeType(ext);

    let stat: fs.Stats;
    try {
      stat = fs.statSync(fullPath);
    } catch {
      failedCount++;
      continue;
    }

    const fingerprint = `${stat.size}:${stat.mtimeMs}`;
    const modifiedIso = stat.mtime.toISOString();
    const createdIso = stat.birthtime.toISOString();
    const existing = existingMap.get(relativePath);

    // ── Incremental Check: Reuse Cached Metadata if Unchanged (unless forced full rescan) ──
    if (!options.forceFullRescan && existing && (existing.fingerprint === fingerprint || (existing.size_bytes === stat.size && existing.file_modified_at === modifiedIso))) {
      pendingBatch.push(() => touchLastScannedStmt.run(existing.id));
      reusedCached++;
      if (options.onProgress) {
        options.onProgress(i + 1, totalFound, filename);
      }
      if (pendingBatch.length >= BATCH_SIZE) commitBatch();
      continue;
    }

    // ── File is New or Modified: Extract Hashes & Metadata ───────────────────
    try {
      let sha256: string | null = null;
      let width: number | null = null;
      let height: number | null = null;
      let durationSeconds: number | null = null;
      let captureTime: string | null = null;
      let hasGps = 0;
      let latitude: number | null = null;
      let longitude: number | null = null;
      let thumbPath: string | null = null;

      let cameraMake: string | null = null;
      let cameraModel: string | null = null;
      let lensModel: string | null = null;
      let iso: number | null = null;
      let focalLength: number | null = null;
      let aperture: number | null = null;
      let exposureTime: string | null = null;
      let orientation: number | null = null;
      let codec: string | null = null;
      let frameRate: number | null = null;
      let bitrate: number | null = null;
      let pageCount: number | null = null;
      let wordCount: number | null = null;
      let docTitle: string | null = null;
      let docAuthor: string | null = null;
      let docSubject: string | null = null;
      let audioArtist: string | null = null;
      let audioAlbum: string | null = null;
      let audioTitle: string | null = null;
      let archiveEntries: number | null = null;
      let colorProfile: string | null = null;
      let availabilityStatus = 'available';
      let extractorVersion = '2.0.0';
      let metadataJson: string | null = null;
      let textContent = '';

      // Compute cryptographic hash via native streaming I/O
      try {
        sha256 = await computeFileHashStream(fullPath);
      } catch {
        try {
          const hashes = await aiClient.computeHashes(fullPath);
          sha256 = hashes.sha256;
        } catch {}
      }

      // Extract rich metadata via AI Worker
      try {
        const meta = await aiClient.extractMetadata(fullPath);
        width = meta.width ?? null;
        height = meta.height ?? null;
        durationSeconds = meta.duration_seconds ?? null;
        captureTime = meta.capture_time ?? null;
        if (meta.has_gps && meta.latitude !== null && meta.longitude !== null) {
          hasGps = 1;
          latitude = meta.latitude;
          longitude = meta.longitude;
        }
        cameraMake = meta.camera_make ?? null;
        cameraModel = meta.camera_model ?? null;
        lensModel = meta.lens_model ?? null;
        iso = meta.iso ?? null;
        focalLength = meta.focal_length ?? null;
        aperture = meta.aperture ?? null;
        exposureTime = meta.exposure_time ?? null;
        orientation = meta.orientation ?? null;
        codec = meta.codec ?? null;
        frameRate = meta.frame_rate ?? null;
        bitrate = meta.bitrate ?? null;
        pageCount = meta.page_count ?? null;
        wordCount = meta.word_count ?? null;
        docTitle = meta.doc_title ?? null;
        docAuthor = meta.doc_author ?? null;
        docSubject = meta.doc_subject ?? null;
        audioArtist = meta.audio_artist ?? null;
        audioAlbum = meta.audio_album ?? null;
        audioTitle = meta.audio_title ?? null;
        archiveEntries = meta.archive_entries ?? null;
        colorProfile = meta.color_profile ?? null;
        if (meta.status === 'corrupt') availabilityStatus = 'corrupt';
        else if (meta.status === 'encrypted') availabilityStatus = 'encrypted';
        else availabilityStatus = 'available';
        extractorVersion = meta.extractor_version || '2.0.0';
        metadataJson = JSON.stringify(meta);
        textContent = [
          docTitle, docAuthor, docSubject,
          audioArtist, audioAlbum, audioTitle,
          cameraMake, cameraModel,
          meta.text_preview
        ].filter(Boolean).join(' ');
      } catch {
        availabilityStatus = 'error';
      }

      // Generate thumbnail for media files
      const isMedia = isImageFile(ext) || isVideoFile(ext);
      if (isMedia && options.generateThumbnails !== false) {
        const thumbFilename = `${sha256 || uuidv4()}.jpg`;
        const targetThumb = path.join(thumbDir, thumbFilename);
        if (fs.existsSync(targetThumb)) {
          thumbPath = targetThumb;
        } else {
          try {
            const thumbRes = await aiClient.generateThumbnail(fullPath, targetThumb, 256);
            if (thumbRes.success) {
              thumbPath = targetThumb;
            }
          } catch {}
        }
      }

      const fileId = existing ? existing.id : uuidv4();

      // Phase 2A Scope: In Phase 2A, face recognition is deferred to Phase 2B.
      const facesToInsert: any[] = [];
      const allowAi = options.extractAi === true && executionParams.allowBackgroundAi && settings.enableBackgroundAi !== 'false';
      let processingStatus: 'pending' | 'completed' = 'completed';

      if (allowAi && isImageFile(ext)) {
        if (!executionParams.deferHeavyAi) {
          try {
            const detections = await aiClient.detectFaces(fullPath);
            for (const d of detections) {
              facesToInsert.push({
                id: uuidv4(),
                fileId,
                x: d.x,
                y: d.y,
                width: d.width,
                height: d.height,
                confidence: d.confidence,
                quality_score: d.quality_score,
                embedding: Buffer.from(new Float32Array(d.embedding).buffer),
              });
            }
          } catch {}
        } else {
          processingStatus = 'pending';
          pendingBatch.push(() => {
            enqueueJobStmt.run(
              uuidv4(),
              'face_detect',
              'queued',
              4,
              0,
              1,
              fullPath,
              fileId,
              JSON.stringify({ fileId, filePath: fullPath })
            );
          });
        }
      } else if (allowAi && isVideoFile(ext)) {
        processingStatus = 'pending';
        pendingBatch.push(() => {
          enqueueJobStmt.run(
            uuidv4(),
            'video_analyze',
            'queued',
            4,
            0,
            1,
            fullPath,
            fileId,
            JSON.stringify({ fileId, filePath: fullPath, intervalSeconds: executionParams.videoSamplingIntervalSeconds })
          );
        });
      }

      const fileParams = {
        id: fileId,
        root_id: rootId,
        relative_path: relativePath,
        filename,
        extension: ext,
        mime_type: mime,
        size_bytes: stat.size,
        hash_sha256: sha256,
        width,
        height,
        duration_seconds: durationSeconds,
        capture_time: captureTime,
        file_created_at: createdIso,
        file_modified_at: modifiedIso,
        has_gps: hasGps,
        latitude,
        longitude,
        thumbnail_path: thumbPath,
        metadata_json: metadataJson,
        processing_status: processingStatus,
        camera_make: cameraMake,
        camera_model: cameraModel,
        lens_model: lensModel,
        iso,
        focal_length: focalLength,
        aperture,
        exposure_time: exposureTime,
        orientation,
        codec,
        frame_rate: frameRate,
        bitrate,
        page_count: pageCount,
        word_count: wordCount,
        doc_title: docTitle,
        doc_author: docAuthor,
        doc_subject: docSubject,
        audio_artist: audioArtist,
        audio_album: audioAlbum,
        audio_title: audioTitle,
        archive_entries: archiveEntries,
        color_profile: colorProfile,
        fingerprint,
        availability_status: availabilityStatus,
        extractor_version: extractorVersion,
      };

      // Schedule DB insert/update in batch
      if (existing) {
        pendingBatch.push(() => {
          updateFileStmt.run(fileParams);
          // Update FTS
          deleteFtsStmt.run(fileId);
          insertFtsStmt.run(fileId, filename, fullPath, textContent);
          // Insert faces if any
          for (const f of facesToInsert) {
            insertFaceStmt.run(f.id, f.fileId, f.x, f.y, f.width, f.height, f.confidence, f.quality_score, f.embedding);
          }
        });
        updatedExisting++;
      } else {
        pendingBatch.push(() => {
          insertFileStmt.run(fileParams);
          // Insert FTS
          insertFtsStmt.run(fileId, filename, fullPath, textContent);
          // Insert faces if any
          for (const f of facesToInsert) {
            insertFaceStmt.run(f.id, f.fileId, f.x, f.y, f.width, f.height, f.confidence, f.quality_score, f.embedding);
          }
        });
        indexedNew++;
      }

      if (pendingBatch.length >= BATCH_SIZE) {
        commitBatch();
      }
    } catch (err) {
      failedCount++;
    }

    if (options.onProgress) {
      options.onProgress(i + 1, totalFound, filename);
    }
  }

  // Final batch flush
  commitBatch();

  // 4. Missing Files Reconciliation
  if (options.onStageChange) {
    options.onStageChange('reconciliation');
  }

  // Files in database for this root that were not found on disk are flagged as is_missing = 1.
  // We NEVER delete records or original files!
  try {
    const discoveredPathsSet = new Set(filePaths.map(p => path.relative(normalizedRoot, p)));
    const markMissingStmt = db.prepare(`
      UPDATE files SET is_missing = 1, availability_status = 'missing', updated_at = datetime('now')
      WHERE root_id = ? AND id = ?
    `);

    const missingOps: Array<() => void> = [];
    for (const row of existingRows) {
      if (!discoveredPathsSet.has(row.relative_path)) {
        missingOps.push(() => markMissingStmt.run(rootId, row.id));
      }
    }

    if (missingOps.length > 0) {
      const runMissing = db.transaction((ops: Array<() => void>) => {
        for (const op of ops) op();
      });
      runMissing(missingOps);
      console.log(`[Indexer] Reconciled root ${normalizedRoot}: flagged ${missingOps.length} missing files.`);
    }
  } catch (reconcileErr) {
    console.warn('[Indexer] Missing file reconciliation warning:', reconcileErr);
  }

  // 5. Run duplicate detection grouping on newly indexed library
  if (options.onStageChange) {
    options.onStageChange('deduplication');
  }
  try {
    recalculateDuplicates();
  } catch (err) {
    console.warn('[Indexer] Duplicate detection grouping error:', err);
  }

  // Update root scan telemetry and status
  try {
    const sizeStmt = db.prepare('SELECT SUM(size_bytes) as total FROM files WHERE root_id = ? AND is_missing = 0');
    const sizeRow = typeof sizeStmt?.get === 'function' ? (sizeStmt.get(rootId) as any) : null;
    const totalSizeBytes = sizeRow?.total || 0;
    updateRootScanStatus(rootId, 'completed', totalFound, totalSizeBytes, null);
  } catch {}

  const durationMs = Date.now() - startTime;
  console.log(`[Indexer] Finished scanning ${normalizedRoot} in ${durationMs}ms. Found: ${totalFound}, New: ${indexedNew}, Updated: ${updatedExisting}, Reused: ${reusedCached}, Failed: ${failedCount}`);

  return {
    rootId,
    totalFound,
    indexedNew,
    updatedExisting,
    reusedCached,
    failedCount,
    durationMs,
  };
}

// ─── Duplicate Detection Engine ──────────────────────────────────────────────

function hammingDistance(hex1: string, hex2: string): number {
  if (!hex1 || !hex2 || hex1.length !== hex2.length) return 64;
  let dist = 0;
  for (let i = 0; i < hex1.length; i++) {
    const xor = parseInt(hex1[i], 16) ^ parseInt(hex2[i], 16);
    dist += (xor & 1) + ((xor >> 1) & 1) + ((xor >> 2) & 1) + ((xor >> 3) & 1);
  }
  return dist;
}

export function recalculateDuplicates(): void {
  const db = getDb();

  // 1. Find exact duplicate groups by identical SHA-256 hash (excluding 0-byte empty files and missing files)
  const duplicateHashRows = db.prepare(`
    SELECT hash_sha256, COUNT(*) as file_count, SUM(size_bytes) as total_size
    FROM files
    WHERE hash_sha256 IS NOT NULL AND hash_sha256 != '' AND size_bytes > 0 AND is_missing = 0
    GROUP BY hash_sha256
    HAVING COUNT(*) > 1
  `).all() as Array<{ hash_sha256: string; file_count: number; total_size: number }>;

  const insertGroupStmt = db.prepare(`
    INSERT INTO duplicate_groups (id, type, hash, similarity_score, file_count, total_size, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'pending', datetime('now'))
  `);

  const insertGroupFileStmt = db.prepare(`
    INSERT INTO duplicate_group_files (group_id, file_id, is_original)
    VALUES (?, ?, ?)
  `);

  const findFilesByHashStmt = db.prepare(`
    SELECT id, file_created_at FROM files WHERE hash_sha256 = ? AND is_missing = 0 ORDER BY file_created_at ASC
  `);

  // Execute in single transaction
  const executeDeduplication = db.transaction(() => {
    // Clear old pending groups
    db.prepare("DELETE FROM duplicate_groups WHERE status = 'pending'").run();

    const exactMemberFileIds = new Set<string>();

    for (const row of duplicateHashRows) {
      const groupId = uuidv4();
      insertGroupStmt.run(groupId, 'exact', row.hash_sha256, 1.0, row.file_count, row.total_size);

      const files = findFilesByHashStmt.all(row.hash_sha256) as Array<{ id: string; file_created_at: string }>;
      for (let i = 0; i < files.length; i++) {
        // Earliest created file is designated as canonical original
        insertGroupFileStmt.run(groupId, files[i].id, i === 0 ? 1 : 0);
        exactMemberFileIds.add(files[i].id);
      }
    }

    // 2. Find perceptual visual similarity candidates (excluding files already in exact groups)
    try {
      const candidates = db.prepare(`
        SELECT id, size_bytes, file_created_at, metadata_json
        FROM files
        WHERE metadata_json LIKE '%"dhash"%'
      `).all() as Array<{ id: string; size_bytes: number; file_created_at: string; metadata_json: string }>;

      const dhashList: Array<{ id: string; dhash: string; size: number; createdAt: string }> = [];
      for (const c of candidates) {
        if (exactMemberFileIds.has(c.id)) continue;
        try {
          const parsed = JSON.parse(c.metadata_json);
          if (parsed?.dhash && typeof parsed.dhash === 'string') {
            dhashList.push({ id: c.id, dhash: parsed.dhash, size: c.size_bytes, createdAt: c.file_created_at });
          }
        } catch {}
      }

      const visited = new Set<string>();
      for (let i = 0; i < dhashList.length; i++) {
        const itemA = dhashList[i];
        if (visited.has(itemA.id)) continue;

        const similarGroup = [itemA];
        for (let j = i + 1; j < dhashList.length; j++) {
          const itemB = dhashList[j];
          if (visited.has(itemB.id)) continue;

          const dist = hammingDistance(itemA.dhash, itemB.dhash);
          if (dist <= 2) {
            similarGroup.push(itemB);
            visited.add(itemB.id);
          }
        }

        if (similarGroup.length > 1) {
          visited.add(itemA.id);
          const groupId = uuidv4();
          const totalSize = similarGroup.reduce((acc, curr) => acc + curr.size, 0);
          insertGroupStmt.run(groupId, 'visual_similarity', itemA.dhash, 0.92, similarGroup.length, totalSize);

          similarGroup.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
          for (let k = 0; k < similarGroup.length; k++) {
            insertGroupFileStmt.run(groupId, similarGroup[k].id, k === 0 ? 1 : 0);
          }
        }
      }
    } catch (err) {
      console.warn('[Indexer] Perceptual dHash grouping notice:', err);
    }
  });

  executeDeduplication();
}

// ─── Missing File Reconciler ─────────────────────────────────────────────────

export function reconcileLibrary(rootId?: string): { checkedCount: number; missingCount: number; restoredCount: number } {
  const db = getDb();
  let query = 'SELECT f.id, f.relative_path, f.is_missing, r.path as root_path FROM files f JOIN roots r ON f.root_id = r.id';
  const params: unknown[] = [];
  if (rootId) {
    query += ' WHERE f.root_id = ?';
    params.push(rootId);
  }
  const rows = db.prepare(query).all(...params) as Array<{ id: string; relative_path: string; is_missing: number; root_path: string }>;

  let checkedCount = 0;
  let missingCount = 0;
  let restoredCount = 0;

  const markMissingStmt = db.prepare("UPDATE files SET is_missing = 1, availability_status = 'missing', updated_at = datetime('now') WHERE id = ?");
  const markAvailableStmt = db.prepare("UPDATE files SET is_missing = 0, availability_status = 'available', updated_at = datetime('now') WHERE id = ?");

  const runReconcile = db.transaction(() => {
    for (const r of rows) {
      checkedCount++;
      const fullPath = path.join(r.root_path, r.relative_path);
      const exists = fs.existsSync(fullPath);
      if (!exists && r.is_missing === 0) {
        markMissingStmt.run(r.id);
        missingCount++;
      } else if (exists && r.is_missing === 1) {
        markAvailableStmt.run(r.id);
        restoredCount++;
      }
    }
  });

  runReconcile();
  return { checkedCount, missingCount, restoredCount };
}
