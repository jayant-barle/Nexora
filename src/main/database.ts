// ============================================================================
// Nexora — Database Service
// Handles SQLite connection, migrations, and core queries
// ============================================================================

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import type { DashboardStats, FileRecord, Job, Person, SearchQuery, SearchResult, Root, WatchRoot, DuplicateGroup } from '../shared/types';

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) throw new Error('Database not initialized');
  return db;
}

export function initDatabase(dbPath: string): Database.Database {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  runMigrations(db);
  return db;
}

function runMigrations(database: Database.Database): void {
  // Check current schema version
  const hasVersionTable = database.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'"
  ).get();

  let currentVersion = 0;
  if (hasVersionTable) {
    const row = database.prepare('SELECT MAX(version) as version FROM schema_version').get() as { version: number } | undefined;
    currentVersion = row?.version ?? 0;
  }

  // Find and run pending migrations
  const migrationsDir = path.join(__dirname, '..', '..', 'database', 'migrations');
  let migrationFiles: string[] = [];
  
  // Try multiple possible paths for migrations
  const possiblePaths = [
    migrationsDir,
    path.join(__dirname, '..', '..', '..', 'database', 'migrations'),
    path.join(process.cwd(), 'database', 'migrations'),
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      migrationFiles = fs.readdirSync(p)
        .filter(f => f.endsWith('.sql'))
        .sort();
      if (migrationFiles.length > 0) {
        const fullPaths = migrationFiles.map(f => path.join(p, f));
        runMigrationFiles(database, fullPaths, currentVersion);
        return;
      }
    }
  }

  // If no migration files found, run inline schema
  if (currentVersion === 0) {
    console.log('No migration files found, creating schema inline...');
    createSchemaInline(database);
  }
}

function runMigrationFiles(database: Database.Database, files: string[], currentVersion: number): void {
  for (const file of files) {
    const versionMatch = path.basename(file).match(/^(\d+)/);
    if (!versionMatch) continue;
    
    const version = parseInt(versionMatch[1], 10);
    if (version <= currentVersion) continue;

    console.log(`Running migration ${path.basename(file)}...`);
    const sql = fs.readFileSync(file, 'utf-8');
    database.exec(sql);
    console.log(`Migration ${path.basename(file)} applied.`);
  }
}

function createSchemaInline(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now')),
      description TEXT
    );
    CREATE TABLE IF NOT EXISTS roots (
      id TEXT PRIMARY KEY, path TEXT NOT NULL UNIQUE, label TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('indexed','watched','managed')),
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY, root_id TEXT NOT NULL REFERENCES roots(id) ON DELETE CASCADE,
      relative_path TEXT NOT NULL, filename TEXT NOT NULL, extension TEXT NOT NULL DEFAULT '',
      mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
      size_bytes INTEGER NOT NULL DEFAULT 0, hash_sha256 TEXT,
      width INTEGER, height INTEGER, duration_seconds REAL,
      capture_time TEXT, file_created_at TEXT, file_modified_at TEXT,
      has_gps INTEGER NOT NULL DEFAULT 0, latitude REAL, longitude REAL,
      thumbnail_path TEXT, metadata_json TEXT,
      processing_status TEXT NOT NULL DEFAULT 'pending',
      last_scanned_at TEXT NOT NULL DEFAULT (datetime('now')),
      camera_make TEXT, camera_model TEXT, lens_model TEXT, iso INTEGER,
      focal_length REAL, aperture REAL, exposure_time TEXT, orientation INTEGER,
      codec TEXT, frame_rate REAL, bitrate INTEGER,
      page_count INTEGER, word_count INTEGER,
      doc_title TEXT, doc_author TEXT, doc_subject TEXT,
      audio_artist TEXT, audio_album TEXT, audio_title TEXT,
      archive_entries INTEGER,
      is_missing INTEGER NOT NULL DEFAULT 0,
      availability_status TEXT NOT NULL DEFAULT 'available',
      extractor_version TEXT,
      extracted_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(root_id, relative_path)
    );
    CREATE INDEX IF NOT EXISTS idx_files_root ON files(root_id);
    CREATE INDEX IF NOT EXISTS idx_files_extension ON files(extension);
    CREATE INDEX IF NOT EXISTS idx_files_hash ON files(hash_sha256);
    CREATE INDEX IF NOT EXISTS idx_files_capture_time ON files(capture_time);
    CREATE INDEX IF NOT EXISTS idx_files_processing ON files(processing_status);
    CREATE INDEX IF NOT EXISTS idx_files_camera ON files(camera_make, camera_model);
    CREATE INDEX IF NOT EXISTS idx_files_author ON files(doc_author);
    CREATE INDEX IF NOT EXISTS idx_files_artist ON files(audio_artist);
    CREATE INDEX IF NOT EXISTS idx_files_missing ON files(is_missing);
    CREATE INDEX IF NOT EXISTS idx_files_availability ON files(availability_status);
    CREATE TABLE IF NOT EXISTS file_versions (
      id TEXT PRIMARY KEY, file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
      hash_sha256 TEXT NOT NULL, size_bytes INTEGER NOT NULL,
      detected_at TEXT NOT NULL DEFAULT (datetime('now')),
      change_type TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS people (
      id TEXT PRIMARY KEY, name TEXT, representative_face_id TEXT,
      is_hidden INTEGER NOT NULL DEFAULT 0, is_excluded INTEGER NOT NULL DEFAULT 0,
      review_status TEXT NOT NULL DEFAULT 'unreviewed',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS face_detections (
      id TEXT PRIMARY KEY, file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
      x REAL NOT NULL, y REAL NOT NULL, width REAL NOT NULL, height REAL NOT NULL,
      confidence REAL NOT NULL, quality_score REAL,
      embedding BLOB, embedding_model TEXT, embedding_version INTEGER,
      thumbnail_path TEXT, is_excluded INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_face_detections_file ON face_detections(file_id);
    CREATE TABLE IF NOT EXISTS face_clusters (
      id TEXT PRIMARY KEY, person_id TEXT REFERENCES people(id) ON DELETE SET NULL,
      centroid_embedding BLOB, model_version TEXT,
      member_count INTEGER NOT NULL DEFAULT 0, avg_confidence REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS cluster_members (
      cluster_id TEXT NOT NULL REFERENCES face_clusters(id) ON DELETE CASCADE,
      face_detection_id TEXT NOT NULL REFERENCES face_detections(id) ON DELETE CASCADE,
      distance REAL NOT NULL, added_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (cluster_id, face_detection_id)
    );
    CREATE TABLE IF NOT EXISTS video_observations (
      id TEXT PRIMARY KEY, file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
      face_detection_id TEXT NOT NULL REFERENCES face_detections(id) ON DELETE CASCADE,
      timestamp_seconds REAL NOT NULL, frame_number INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS file_people (
      file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
      person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
      association_type TEXT NOT NULL DEFAULT 'auto',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (file_id, person_id)
    );
    CREATE TABLE IF NOT EXISTS media_tags (
      id TEXT PRIMARY KEY, file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
      tag TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'user',
      confidence REAL, model_version TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS ocr_results (
      id TEXT PRIMARY KEY, file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
      text TEXT NOT NULL, language TEXT, confidence REAL, model_version TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS locations (
      id TEXT PRIMARY KEY, file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
      latitude REAL NOT NULL, longitude REAL NOT NULL, altitude REAL,
      place_name TEXT, city TEXT, country TEXT,
      source TEXT NOT NULL DEFAULT 'exif',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT,
      start_date TEXT NOT NULL, end_date TEXT, location_name TEXT,
      is_auto_generated INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS event_files (
      event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
      added_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (event_id, file_id)
    );
    CREATE TABLE IF NOT EXISTS collections (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT,
      cover_file_id TEXT REFERENCES files(id) ON DELETE SET NULL,
      is_smart INTEGER NOT NULL DEFAULT 0, smart_query TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS collection_files (
      collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
      file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      added_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (collection_id, file_id)
    );
    CREATE TABLE IF NOT EXISTS copy_operations (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
      source_description TEXT NOT NULL, destination_root TEXT NOT NULL,
      total_files INTEGER NOT NULL DEFAULT 0, completed_files INTEGER NOT NULL DEFAULT 0,
      failed_files INTEGER NOT NULL DEFAULT 0, total_bytes INTEGER NOT NULL DEFAULT 0,
      copied_bytes INTEGER NOT NULL DEFAULT 0, started_at TEXT, completed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS operation_items (
      id TEXT PRIMARY KEY, operation_id TEXT NOT NULL REFERENCES copy_operations(id) ON DELETE CASCADE,
      source_path TEXT NOT NULL, destination_path TEXT NOT NULL,
      source_hash TEXT, destination_hash TEXT,
      status TEXT NOT NULL DEFAULT 'pending', error_message TEXT,
      file_size INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS operation_history (
      id TEXT PRIMARY KEY, operation_type TEXT NOT NULL, description TEXT NOT NULL,
      details_json TEXT, is_undoable INTEGER NOT NULL DEFAULT 0,
      undo_data_json TEXT, status TEXT NOT NULL DEFAULT 'completed',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY, type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      priority INTEGER NOT NULL DEFAULT 5,
      progress INTEGER NOT NULL DEFAULT 0, total INTEGER NOT NULL DEFAULT 0,
      target_path TEXT, target_id TEXT, config_json TEXT,
      error_message TEXT, retry_count INTEGER NOT NULL DEFAULT 0,
      max_retries INTEGER NOT NULL DEFAULT 3,
      started_at TEXT, completed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
    CREATE TABLE IF NOT EXISTS job_errors (
      id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      file_path TEXT, error_type TEXT NOT NULL, error_message TEXT NOT NULL,
      is_recoverable INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS watch_roots (
      id TEXT PRIMARY KEY, path TEXT NOT NULL UNIQUE, label TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1, auto_index INTEGER NOT NULL DEFAULT 1,
      auto_organize INTEGER NOT NULL DEFAULT 0,
      exclude_patterns TEXT NOT NULL DEFAULT '[]',
      last_scan_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS duplicate_groups (
      id TEXT PRIMARY KEY, type TEXT NOT NULL,
      hash TEXT, similarity_score REAL,
      file_count INTEGER NOT NULL DEFAULT 0, total_size INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS duplicate_group_files (
      group_id TEXT NOT NULL REFERENCES duplicate_groups(id) ON DELETE CASCADE,
      file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
      is_original INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (group_id, file_id)
    );
    CREATE TABLE IF NOT EXISTS organization_rules (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      pattern TEXT NOT NULL,
      description TEXT,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS organization_proposals (
      id TEXT PRIMARY KEY,
      rule_id TEXT REFERENCES organization_rules(id) ON DELETE SET NULL,
      source_file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
      source_path TEXT NOT NULL,
      proposed_destination TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'proposed',
      warning_flags TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY, value TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'string',
      category TEXT NOT NULL DEFAULT 'general',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
      file_id UNINDEXED, filename, path, tags, ocr_text, metadata,
      content='', contentless_delete=1, tokenize='unicode61'
    );
    INSERT OR IGNORE INTO schema_version (version, description) VALUES (1, 'Initial schema');
    INSERT OR IGNORE INTO schema_version (version, description) VALUES (2, 'Metadata Intelligence Engine');

    INSERT OR IGNORE INTO organization_rules (id, name, pattern, description, is_default)
    VALUES
      ('rule_default_date', 'Date Hierarchy', '{category}/{YYYY}/{MM}', 'Organize into category and Year/Month folders', 1),
      ('rule_camera_date', 'Camera & Date', 'Media/{camera}/{YYYY}/{MM}', 'Organize media by camera model and date', 0),
      ('rule_person_date', 'Person & Date', 'People/{person}/{YYYY}', 'Organize photos by confirmed person name and year', 0),
      ('rule_docs_author', 'Documents by Author', 'Documents/{author}/{YYYY}', 'Organize documents by author and year', 0),
      ('rule_audio_artist', 'Music by Artist & Album', 'Music/{artist}/{YYYY}', 'Organize audio tracks by artist and year', 0);
  `);
}

// ─── Query Functions ─────────────────────────────────────────────────────────

export function getDashboardStats(): DashboardStats {
  const database = getDb();
  
  const totalFiles = (database.prepare('SELECT COUNT(*) as count FROM files').get() as { count: number }).count;
  const totalImages = (database.prepare("SELECT COUNT(*) as count FROM files WHERE extension IN ('.jpg','.jpeg','.png','.gif','.bmp','.webp','.tiff','.svg','.heic','.heif')").get() as { count: number }).count;
  const totalVideos = (database.prepare("SELECT COUNT(*) as count FROM files WHERE extension IN ('.mp4','.avi','.mov','.mkv','.wmv','.flv','.webm','.m4v')").get() as { count: number }).count;
  const totalPeople = (database.prepare('SELECT COUNT(*) as count FROM people WHERE is_hidden = 0').get() as { count: number }).count;
  const reviewedPeople = (database.prepare("SELECT COUNT(*) as count FROM people WHERE review_status IN ('reviewed','confirmed') AND is_hidden = 0").get() as { count: number }).count;
  const unreviewedPeople = (database.prepare("SELECT COUNT(*) as count FROM people WHERE review_status = 'unreviewed' AND is_hidden = 0").get() as { count: number }).count;
  const duplicateGroups = (database.prepare('SELECT COUNT(*) as count FROM duplicate_groups').get() as { count: number }).count;
  const activeJobs = (database.prepare("SELECT COUNT(*) as count FROM jobs WHERE status = 'running'").get() as { count: number }).count;
  const pendingJobs = (database.prepare("SELECT COUNT(*) as count FROM jobs WHERE status = 'queued'").get() as { count: number }).count;
  const failedJobs = (database.prepare("SELECT COUNT(*) as count FROM jobs WHERE status = 'failed'").get() as { count: number }).count;
  const totalIndexedSize = (database.prepare('SELECT COALESCE(SUM(size_bytes), 0) as total FROM files').get() as { total: number }).total;
  const watchedFolders = (database.prepare('SELECT COUNT(*) as count FROM watch_roots WHERE active = 1').get() as { count: number }).count;
  
  const recentActivity = database.prepare(
    "SELECT id, operation_type as type, description, created_at as timestamp, status FROM operation_history ORDER BY created_at DESC LIMIT 10"
  ).all() as DashboardStats['recentActivity'];

  return {
    totalFiles, totalImages, totalVideos, totalPeople, reviewedPeople,
    unreviewedPeople, duplicateGroups, activeJobs, pendingJobs, failedJobs,
    totalIndexedSize, recentActivity, watchedFolders,
  };
}

export function searchFiles(query: SearchQuery): SearchResult {
  const database = getDb();
  const startTime = Date.now();
  
  const conditions: string[] = ['1=1'];
  const params: Record<string, unknown> = {};

  if (query.text) {
    // Search in filename, relative_path, and full-text search index
    try {
      conditions.push("(f.filename LIKE @text OR f.relative_path LIKE @text OR f.id IN (SELECT file_id FROM search_index WHERE search_index MATCH @ftsQuery))");
      params.text = `%${query.text}%`;
      // Clean query token for FTS
      const cleanFts = query.text.replace(/["*]/g, ' ').trim();
      params.ftsQuery = cleanFts ? `"${cleanFts}"*` : `"${query.text}"`;
    } catch {
      conditions.push("(f.filename LIKE @text OR f.relative_path LIKE @text)");
      params.text = `%${query.text}%`;
    }
  }
  if (query.filename) {
    conditions.push("f.filename LIKE @filename");
    params.filename = `%${query.filename}%`;
  }
  if (query.extension?.length) {
    const exts = query.extension.map((e: string, i: number) => {
      const key = `ext_${i}`;
      params[key] = e.startsWith('.') ? e : `.${e}`;
      return `@${key}`;
    });
    conditions.push(`f.extension IN (${exts.join(',')})`);
  }
  if (query.dateFrom) {
    conditions.push("COALESCE(f.capture_time, f.file_created_at) >= @dateFrom");
    params.dateFrom = query.dateFrom;
  }
  if (query.dateTo) {
    conditions.push("COALESCE(f.capture_time, f.file_created_at) <= @dateTo");
    params.dateTo = query.dateTo;
  }
  if (query.sizeMin !== undefined) {
    conditions.push("f.size_bytes >= @sizeMin");
    params.sizeMin = query.sizeMin;
  }
  if (query.sizeMax !== undefined) {
    conditions.push("f.size_bytes <= @sizeMax");
    params.sizeMax = query.sizeMax;
  }
  if (query.personId) {
    conditions.push("f.id IN (SELECT file_id FROM file_people WHERE person_id = @personId)");
    params.personId = query.personId;
  }
  if (query.rootId) {
    conditions.push("f.root_id = @rootId");
    params.rootId = query.rootId;
  }
  if (query.hasGps) {
    conditions.push("f.has_gps = 1");
  }
  if (query.isMissing !== undefined) {
    conditions.push("f.is_missing = @isMissing");
    params.isMissing = query.isMissing ? 1 : 0;
  }
  if (query.camera) {
    conditions.push("(f.camera_make LIKE @camera OR f.camera_model LIKE @camera)");
    params.camera = `%${query.camera}%`;
  }
  if (query.author) {
    conditions.push("f.doc_author LIKE @author");
    params.author = `%${query.author}%`;
  }
  if (query.artist) {
    conditions.push("(f.audio_artist LIKE @artist OR f.audio_album LIKE @artist)");
    params.artist = `%${query.artist}%`;
  }
  if (query.category) {
    switch (query.category) {
      case 'image':
        conditions.push("(f.mime_type LIKE 'image/%' OR f.extension IN ('.jpg','.jpeg','.png','.gif','.bmp','.webp','.tiff','.svg','.heic','.heif'))");
        break;
      case 'video':
        conditions.push("(f.mime_type LIKE 'video/%' OR f.extension IN ('.mp4','.avi','.mov','.mkv','.wmv','.flv','.webm','.m4v'))");
        break;
      case 'audio':
        conditions.push("(f.mime_type LIKE 'audio/%' OR f.extension IN ('.mp3','.wav','.flac','.m4a','.aac','.ogg','.wma'))");
        break;
      case 'document':
        conditions.push("(f.mime_type LIKE 'application/pdf%' OR f.mime_type LIKE '%word%' OR f.mime_type LIKE '%document%' OR f.mime_type LIKE '%presentation%' OR f.mime_type LIKE '%spreadsheet%' OR f.extension IN ('.pdf','.doc','.docx','.ppt','.pptx','.xls','.xlsx'))");
        break;
      case 'archive':
        conditions.push("(f.mime_type LIKE '%zip%' OR f.mime_type LIKE '%tar%' OR f.extension IN ('.zip','.tar','.gz','.tgz','.7z','.rar'))");
        break;
      case 'text':
        conditions.push("(f.mime_type LIKE 'text/%' OR f.extension IN ('.txt','.md','.csv','.json','.xml','.yaml','.yml','.js','.ts','.py'))");
        break;
      case 'other':
        conditions.push("(f.mime_type NOT LIKE 'image/%' AND f.mime_type NOT LIKE 'video/%' AND f.mime_type NOT LIKE 'audio/%' AND f.mime_type NOT LIKE 'text/%' AND f.mime_type NOT LIKE 'application/pdf%' AND f.extension NOT IN ('.jpg','.jpeg','.png','.gif','.bmp','.webp','.mp4','.mov','.mkv','.mp3','.wav','.flac','.pdf','.docx','.pptx','.xlsx','.zip','.tar','.txt'))");
        break;
    }
  }

  const where = conditions.join(' AND ');
  const sortBy = query.sortBy || 'file_modified_at';
  const sortOrder = query.sortOrder || 'desc';
  const limit = Math.min(query.limit || 50, 200);
  const offset = query.offset || 0;

  const countResult = database.prepare(`SELECT COUNT(*) as count FROM files f WHERE ${where}`).get(params) as { count: number };
  const files = database.prepare(
    `SELECT * FROM files f WHERE ${where} ORDER BY ${sortBy} ${sortOrder} LIMIT @limit OFFSET @offset`
  ).all({ ...params, limit, offset }) as FileRecord[];

  return {
    files,
    totalCount: countResult.count,
    query,
    executionTimeMs: Date.now() - startTime,
  };
}

export function getJobs(status?: string, limit = 50): Job[] {
  const database = getDb();
  if (status) {
    return database.prepare('SELECT * FROM jobs WHERE status = ? ORDER BY created_at DESC LIMIT ?').all(status, limit) as Job[];
  }
  return database.prepare('SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?').all(limit) as Job[];
}

export function createJob(type: string, targetPath?: string, targetId?: string, config?: Record<string, unknown>): Job {
  const database = getDb();
  const id = uuidv4();
  const now = new Date().toISOString();
  
  database.prepare(`
    INSERT INTO jobs (id, type, status, priority, progress, total, target_path, target_id, config_json, created_at, updated_at)
    VALUES (?, ?, 'queued', 5, 0, 0, ?, ?, ?, ?, ?)
  `).run(id, type, targetPath ?? null, targetId ?? null, config ? JSON.stringify(config) : null, now, now);
  
  return database.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as Job;
}

export function updateJobStatus(id: string, status: string, progress?: number, total?: number, error?: string): void {
  const database = getDb();
  const now = new Date().toISOString();
  const updates: string[] = ['status = ?', 'updated_at = ?'];
  const params: unknown[] = [status, now];
  
  if (progress !== undefined) { updates.push('progress = ?'); params.push(progress); }
  if (total !== undefined) { updates.push('total = ?'); params.push(total); }
  if (error !== undefined) { updates.push('error_message = ?'); params.push(error); }
  if (status === 'running') { updates.push("started_at = COALESCE(started_at, ?)"); params.push(now); }
  if (status === 'completed' || status === 'failed') { updates.push('completed_at = ?'); params.push(now); }
  
  params.push(id);
  database.prepare(`UPDATE jobs SET ${updates.join(', ')} WHERE id = ?`).run(...params);
}

export function getPeople(includeHidden = false): Person[] {
  const database = getDb();
  const query = includeHidden
    ? 'SELECT p.*, (SELECT COUNT(*) FROM file_people fp WHERE fp.person_id = p.id) as file_count FROM people p ORDER BY p.name ASC, p.created_at DESC'
    : 'SELECT p.*, (SELECT COUNT(*) FROM file_people fp WHERE fp.person_id = p.id) as file_count FROM people p WHERE p.is_hidden = 0 ORDER BY p.name ASC, p.created_at DESC';
  return database.prepare(query).all() as Person[];
}

export function getRoots(): Root[] {
  return getDb().prepare('SELECT * FROM roots ORDER BY label ASC').all() as Root[];
}

export function addRoot(pathStr: string, label: string, type: 'indexed' | 'watched' | 'managed'): Root {
  const database = getDb();
  const id = uuidv4();
  const now = new Date().toISOString();
  database.prepare('INSERT INTO roots (id, path, label, type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, pathStr, label, type, now, now);
  return database.prepare('SELECT * FROM roots WHERE id = ?').get(id) as Root;
}

export function getWatchRoots(): WatchRoot[] {
  return getDb().prepare('SELECT * FROM watch_roots ORDER BY label ASC').all() as WatchRoot[];
}

export function addWatchRoot(pathStr: string, label: string): WatchRoot {
  const database = getDb();
  const id = uuidv4();
  const now = new Date().toISOString();
  database.prepare('INSERT INTO watch_roots (id, path, label, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(id, pathStr, label, now, now);
  return database.prepare('SELECT * FROM watch_roots WHERE id = ?').get(id) as WatchRoot;
}

export function getSettings(): Record<string, string> {
  const rows = getDb().prepare('SELECT key, value FROM app_settings').all() as { key: string; value: string }[];
  const result: Record<string, string> = {};
  for (const row of rows) { result[row.key] = row.value; }
  return result;
}

export function setSetting(key: string, value: string, type = 'string', category = 'general'): void {
  getDb().prepare(`
    INSERT INTO app_settings (key, value, type, category, updated_at) VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
  `).run(key, value, type, category);
}

export function getDuplicateGroups(): DuplicateGroup[] {
  return getDb().prepare('SELECT * FROM duplicate_groups ORDER BY total_size DESC').all() as DuplicateGroup[];
}

export function checkDatabaseIntegrity(): { ok: boolean; message: string } {
  try {
    const row = getDb().prepare('PRAGMA integrity_check').get() as { integrity_check: string };
    const ok = row?.integrity_check === 'ok';
    return { ok, message: row?.integrity_check || 'Unknown status' };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

export function vacuumDatabase(): boolean {
  try {
    getDb().exec('VACUUM');
    return true;
  } catch (err) {
    console.error('Failed to vacuum database:', err);
    return false;
  }
}

export function rebuildSearchIndex(): { success: boolean; indexedCount: number } {
  const database = getDb();
  try {
    const countRow = database.prepare('SELECT COUNT(*) as count FROM files').get() as { count: number };
    const rebuild = database.transaction(() => {
      database.exec('DELETE FROM search_index');
      database.exec(`
        INSERT INTO search_index (file_id, filename, path, tags, ocr_text, metadata)
        SELECT f.id, f.filename, (r.path || '/' || f.relative_path), '', '',
          COALESCE(f.camera_make, '') || ' ' || COALESCE(f.camera_model, '') || ' ' || COALESCE(f.doc_author, '') || ' ' || COALESCE(f.doc_title, '') || ' ' || COALESCE(f.audio_artist, '') || ' ' || COALESCE(f.metadata_json, '')
        FROM files f
        JOIN roots r ON f.root_id = r.id
      `);
    });
    rebuild();
    return { success: true, indexedCount: countRow.count };
  } catch (err) {
    console.error('Failed to rebuild search index:', err);
    return { success: false, indexedCount: 0 };
  }
}

export function resolveDuplicateGroup(
  groupId: string,
  action: 'keep_best' | 'recycle' | 'hardlink'
): { success: boolean; filesAffected: number; bytesReclaimed: number } {
  const database = getDb();
  const group = database.prepare('SELECT * FROM duplicate_groups WHERE id = ?').get(groupId) as any;
  if (!group) {
    throw new Error(`Duplicate group ${groupId} not found`);
  }

  const groupFiles = database.prepare(`
    SELECT f.*, dgf.is_original
    FROM duplicate_group_files dgf
    JOIN files f ON dgf.file_id = f.id
    WHERE dgf.group_id = ?
    ORDER BY dgf.is_original DESC, f.file_created_at ASC
  `).all(groupId) as any[];

  if (groupFiles.length <= 1) {
    database.prepare("UPDATE duplicate_groups SET status = 'resolved' WHERE id = ?").run(groupId);
    return { success: true, filesAffected: 0, bytesReclaimed: 0 };
  }

  const original = groupFiles[0];
  const duplicates = groupFiles.slice(1);
  let filesAffected = 0;
  let bytesReclaimed = 0;

  if (action === 'keep_best') {
    // Designate original, keep duplicates marked
    database.prepare("UPDATE duplicate_groups SET status = 'resolved' WHERE id = ?").run(groupId);
    return { success: true, filesAffected: duplicates.length, bytesReclaimed: 0 };
  }

  if (action === 'recycle') {
    // Delete non-original duplicates
    for (const dup of duplicates) {
      try {
        // Resolve full path
        const root = database.prepare('SELECT path FROM roots WHERE id = ?').get(dup.root_id) as any;
        if (root) {
          const fullPath = path.join(root.path, dup.relative_path);
          if (fs.existsSync(fullPath)) {
            fs.unlinkSync(fullPath);
            bytesReclaimed += dup.size_bytes;
            filesAffected++;
          }
        }
        database.prepare('DELETE FROM files WHERE id = ?').run(dup.id);
      } catch (err) {
        console.warn(`Failed to delete duplicate file ${dup.id}:`, err);
      }
    }
    database.prepare("UPDATE duplicate_groups SET status = 'resolved' WHERE id = ?").run(groupId);
  }

  return { success: true, filesAffected, bytesReclaimed };
}

export function mergePeople(targetPersonId: string, sourcePersonIds: string[]): boolean {
  const database = getDb();
  if (sourcePersonIds.length === 0) return true;

  const merge = database.transaction(() => {
    for (const srcId of sourcePersonIds) {
      if (srcId === targetPersonId) continue;
      // Re-assign face clusters
      database.prepare('UPDATE face_clusters SET person_id = ? WHERE person_id = ?').run(targetPersonId, srcId);
      // Re-assign file links
      database.prepare(`
        INSERT OR IGNORE INTO file_people (file_id, person_id, association_type)
        SELECT file_id, ?, association_type FROM file_people WHERE person_id = ?
      `).run(targetPersonId, srcId);
      database.prepare('DELETE FROM file_people WHERE person_id = ?').run(srcId);
      // Delete source person
      database.prepare('DELETE FROM people WHERE id = ?').run(srcId);
    }
  });

  merge();
  return true;
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}
