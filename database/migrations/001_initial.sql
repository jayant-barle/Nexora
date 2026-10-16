-- Nexora — Database Schema v1
-- SQLite with foreign keys, FTS5, and versioned migrations

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ─── Schema Version ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now')),
  description TEXT
);

INSERT INTO schema_version (version, description) VALUES (1, 'Initial schema');

-- ─── Roots ───────────────────────────────────────────────────────────────────

CREATE TABLE roots (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('indexed', 'watched', 'managed')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ─── Files ───────────────────────────────────────────────────────────────────

CREATE TABLE files (
  id TEXT PRIMARY KEY,
  root_id TEXT NOT NULL REFERENCES roots(id) ON DELETE CASCADE,
  relative_path TEXT NOT NULL,
  filename TEXT NOT NULL,
  extension TEXT NOT NULL DEFAULT '',
  mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  size_bytes INTEGER NOT NULL DEFAULT 0,
  hash_sha256 TEXT,
  width INTEGER,
  height INTEGER,
  duration_seconds REAL,
  capture_time TEXT,
  file_created_at TEXT,
  file_modified_at TEXT,
  has_gps INTEGER NOT NULL DEFAULT 0,
  latitude REAL,
  longitude REAL,
  thumbnail_path TEXT,
  metadata_json TEXT,
  processing_status TEXT NOT NULL DEFAULT 'pending' CHECK(processing_status IN ('pending', 'processing', 'completed', 'failed', 'skipped')),
  last_scanned_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(root_id, relative_path)
);

CREATE INDEX idx_files_root ON files(root_id);
CREATE INDEX idx_files_extension ON files(extension);
CREATE INDEX idx_files_hash ON files(hash_sha256);
CREATE INDEX idx_files_capture_time ON files(capture_time);
CREATE INDEX idx_files_processing ON files(processing_status);
CREATE INDEX idx_files_size ON files(size_bytes);
CREATE INDEX idx_files_modified ON files(file_modified_at);

-- ─── File Versions (track changes) ──────────────────────────────────────────

CREATE TABLE file_versions (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  hash_sha256 TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  detected_at TEXT NOT NULL DEFAULT (datetime('now')),
  change_type TEXT NOT NULL CHECK(change_type IN ('created', 'modified', 'renamed', 'moved', 'deleted'))
);

CREATE INDEX idx_file_versions_file ON file_versions(file_id);

-- ─── People ──────────────────────────────────────────────────────────────────

CREATE TABLE people (
  id TEXT PRIMARY KEY,
  name TEXT,
  representative_face_id TEXT,
  is_hidden INTEGER NOT NULL DEFAULT 0,
  is_excluded INTEGER NOT NULL DEFAULT 0,
  review_status TEXT NOT NULL DEFAULT 'unreviewed' CHECK(review_status IN ('unreviewed', 'reviewed', 'confirmed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_people_name ON people(name);
CREATE INDEX idx_people_status ON people(review_status);

-- ─── Face Detections ─────────────────────────────────────────────────────────

CREATE TABLE face_detections (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  x REAL NOT NULL,
  y REAL NOT NULL,
  width REAL NOT NULL,
  height REAL NOT NULL,
  confidence REAL NOT NULL,
  quality_score REAL,
  embedding BLOB,
  embedding_model TEXT,
  embedding_version INTEGER,
  thumbnail_path TEXT,
  is_excluded INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_face_detections_file ON face_detections(file_id);
CREATE INDEX idx_face_detections_confidence ON face_detections(confidence);

-- ─── Face Clusters ───────────────────────────────────────────────────────────

CREATE TABLE face_clusters (
  id TEXT PRIMARY KEY,
  person_id TEXT REFERENCES people(id) ON DELETE SET NULL,
  centroid_embedding BLOB,
  model_version TEXT,
  member_count INTEGER NOT NULL DEFAULT 0,
  avg_confidence REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_face_clusters_person ON face_clusters(person_id);

-- ─── Cluster Members ─────────────────────────────────────────────────────────

CREATE TABLE cluster_members (
  cluster_id TEXT NOT NULL REFERENCES face_clusters(id) ON DELETE CASCADE,
  face_detection_id TEXT NOT NULL REFERENCES face_detections(id) ON DELETE CASCADE,
  distance REAL NOT NULL,
  added_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (cluster_id, face_detection_id)
);

-- ─── Video Observations ──────────────────────────────────────────────────────

CREATE TABLE video_observations (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  face_detection_id TEXT NOT NULL REFERENCES face_detections(id) ON DELETE CASCADE,
  timestamp_seconds REAL NOT NULL,
  frame_number INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_video_obs_file ON video_observations(file_id);
CREATE INDEX idx_video_obs_timestamp ON video_observations(timestamp_seconds);

-- ─── File-Person Associations (many-to-many) ─────────────────────────────────

CREATE TABLE file_people (
  file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  association_type TEXT NOT NULL DEFAULT 'auto' CHECK(association_type IN ('auto', 'manual', 'confirmed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (file_id, person_id)
);

CREATE INDEX idx_file_people_person ON file_people(person_id);

-- ─── Media Tags ──────────────────────────────────────────────────────────────

CREATE TABLE media_tags (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'user' CHECK(source IN ('user', 'ai', 'ocr')),
  confidence REAL,
  model_version TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_media_tags_file ON media_tags(file_id);
CREATE INDEX idx_media_tags_tag ON media_tags(tag);

-- ─── OCR Results ─────────────────────────────────────────────────────────────

CREATE TABLE ocr_results (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  language TEXT,
  confidence REAL,
  model_version TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_ocr_results_file ON ocr_results(file_id);

-- ─── Locations ───────────────────────────────────────────────────────────────

CREATE TABLE locations (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  altitude REAL,
  place_name TEXT,
  city TEXT,
  country TEXT,
  source TEXT NOT NULL DEFAULT 'exif' CHECK(source IN ('exif', 'user', 'inferred')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_locations_file ON locations(file_id);
CREATE INDEX idx_locations_coords ON locations(latitude, longitude);

-- ─── Events ──────────────────────────────────────────────────────────────────

CREATE TABLE events (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  start_date TEXT NOT NULL,
  end_date TEXT,
  location_name TEXT,
  is_auto_generated INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_events_date ON events(start_date);

-- ─── Event Files ─────────────────────────────────────────────────────────────

CREATE TABLE event_files (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  added_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (event_id, file_id)
);

-- ─── Collections ─────────────────────────────────────────────────────────────

CREATE TABLE collections (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  cover_file_id TEXT REFERENCES files(id) ON DELETE SET NULL,
  is_smart INTEGER NOT NULL DEFAULT 0,
  smart_query TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ─── Collection Files ────────────────────────────────────────────────────────

CREATE TABLE collection_files (
  collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  added_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (collection_id, file_id)
);

-- ─── Copy Operations ────────────────────────────────────────────────────────

CREATE TABLE copy_operations (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK(type IN ('person_organize', 'timeline_organize', 'manual_copy', 'export')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'in_progress', 'completed', 'failed', 'cancelled', 'undone')),
  source_description TEXT NOT NULL,
  destination_root TEXT NOT NULL,
  total_files INTEGER NOT NULL DEFAULT 0,
  completed_files INTEGER NOT NULL DEFAULT 0,
  failed_files INTEGER NOT NULL DEFAULT 0,
  total_bytes INTEGER NOT NULL DEFAULT 0,
  copied_bytes INTEGER NOT NULL DEFAULT 0,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ─── Operation Items ─────────────────────────────────────────────────────────

CREATE TABLE operation_items (
  id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL REFERENCES copy_operations(id) ON DELETE CASCADE,
  source_path TEXT NOT NULL,
  destination_path TEXT NOT NULL,
  source_hash TEXT,
  destination_hash TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'copied', 'verified', 'failed', 'undone')),
  error_message TEXT,
  file_size INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_op_items_operation ON operation_items(operation_id);

-- ─── Operation History (audit log) ──────────────────────────────────────────

CREATE TABLE operation_history (
  id TEXT PRIMARY KEY,
  operation_type TEXT NOT NULL,
  description TEXT NOT NULL,
  details_json TEXT,
  is_undoable INTEGER NOT NULL DEFAULT 0,
  undo_data_json TEXT,
  status TEXT NOT NULL DEFAULT 'completed',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_op_history_type ON operation_history(operation_type);
CREATE INDEX idx_op_history_date ON operation_history(created_at);

-- ─── Jobs ────────────────────────────────────────────────────────────────────

CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued', 'running', 'paused', 'completed', 'failed', 'cancelled')),
  priority INTEGER NOT NULL DEFAULT 5,
  progress INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  target_path TEXT,
  target_id TEXT,
  config_json TEXT,
  error_message TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 3,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_jobs_status ON jobs(status);
CREATE INDEX idx_jobs_type ON jobs(type);
CREATE INDEX idx_jobs_priority ON jobs(priority);

-- ─── Job Errors ──────────────────────────────────────────────────────────────

CREATE TABLE job_errors (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  file_path TEXT,
  error_type TEXT NOT NULL,
  error_message TEXT NOT NULL,
  is_recoverable INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_job_errors_job ON job_errors(job_id);

-- ─── Watch Roots ─────────────────────────────────────────────────────────────

CREATE TABLE watch_roots (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  auto_index INTEGER NOT NULL DEFAULT 1,
  auto_organize INTEGER NOT NULL DEFAULT 0,
  exclude_patterns TEXT NOT NULL DEFAULT '[]',
  last_scan_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ─── Duplicate Groups ────────────────────────────────────────────────────────

CREATE TABLE duplicate_groups (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK(type IN ('exact', 'similar')),
  hash TEXT,
  similarity_score REAL,
  file_count INTEGER NOT NULL DEFAULT 0,
  total_size INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'reviewed', 'resolved')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_dup_groups_type ON duplicate_groups(type);
CREATE INDEX idx_dup_groups_hash ON duplicate_groups(hash);

-- ─── Duplicate Group Files ───────────────────────────────────────────────────

CREATE TABLE duplicate_group_files (
  group_id TEXT NOT NULL REFERENCES duplicate_groups(id) ON DELETE CASCADE,
  file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  is_original INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (group_id, file_id)
);

-- ─── App Settings ────────────────────────────────────────────────────────────

CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'string' CHECK(type IN ('string', 'number', 'boolean', 'json')),
  category TEXT NOT NULL DEFAULT 'general',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ─── Full-Text Search Index ──────────────────────────────────────────────────

CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
  file_id UNINDEXED,
  filename,
  path,
  tags,
  ocr_text,
  metadata,
  content='',
  contentless_delete=1,
  tokenize='unicode61'
);
