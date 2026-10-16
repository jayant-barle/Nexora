-- Nexora — Database Schema Migration v2
-- Metadata Intelligence Engine & Organization Rules

-- ─── Add Extended Metadata Columns to Files Table ───────────────────────────

ALTER TABLE files ADD COLUMN camera_make TEXT;
ALTER TABLE files ADD COLUMN camera_model TEXT;
ALTER TABLE files ADD COLUMN lens_model TEXT;
ALTER TABLE files ADD COLUMN iso INTEGER;
ALTER TABLE files ADD COLUMN focal_length REAL;
ALTER TABLE files ADD COLUMN aperture REAL;
ALTER TABLE files ADD COLUMN exposure_time TEXT;
ALTER TABLE files ADD COLUMN orientation INTEGER;
ALTER TABLE files ADD COLUMN codec TEXT;
ALTER TABLE files ADD COLUMN frame_rate REAL;
ALTER TABLE files ADD COLUMN bitrate INTEGER;
ALTER TABLE files ADD COLUMN page_count INTEGER;
ALTER TABLE files ADD COLUMN word_count INTEGER;
ALTER TABLE files ADD COLUMN doc_title TEXT;
ALTER TABLE files ADD COLUMN doc_author TEXT;
ALTER TABLE files ADD COLUMN doc_subject TEXT;
ALTER TABLE files ADD COLUMN audio_artist TEXT;
ALTER TABLE files ADD COLUMN audio_album TEXT;
ALTER TABLE files ADD COLUMN audio_title TEXT;
ALTER TABLE files ADD COLUMN archive_entries INTEGER;
ALTER TABLE files ADD COLUMN is_missing INTEGER NOT NULL DEFAULT 0;
ALTER TABLE files ADD COLUMN availability_status TEXT NOT NULL DEFAULT 'available';
ALTER TABLE files ADD COLUMN extractor_version TEXT;
ALTER TABLE files ADD COLUMN extracted_at TEXT;

-- ─── Indexes for Accelerated Querying ────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_files_camera ON files(camera_make, camera_model);
CREATE INDEX IF NOT EXISTS idx_files_missing ON files(is_missing);
CREATE INDEX IF NOT EXISTS idx_files_availability ON files(availability_status);
CREATE INDEX IF NOT EXISTS idx_files_doc_author ON files(doc_author);
CREATE INDEX IF NOT EXISTS idx_files_audio_artist ON files(audio_artist);

-- ─── Organization Rules Table ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS organization_rules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  pattern TEXT NOT NULL,
  fallback_behavior TEXT NOT NULL DEFAULT 'use_fallbacks',
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Default organization rule presets
INSERT OR IGNORE INTO organization_rules (id, name, description, pattern, fallback_behavior, is_default)
VALUES 
  ('rule-date-category', 'Category and Date', 'Organize files by category and capture date (e.g. Images/2026/10)', '{category}/{YYYY}/{MM}', 'use_fallbacks', 1),
  ('rule-camera-year', 'Camera and Year', 'Organize media by camera model and capture year (e.g. Media/Sony A7IV/2026)', 'Media/{camera}/{YYYY}', 'use_fallbacks', 0),
  ('rule-person-date', 'Person and Date', 'Organize photos by confirmed person and date (e.g. Photos/Sarah/2026/10)', 'Photos/{person}/{YYYY}/{MM}', 'use_fallbacks', 0),
  ('rule-docs-author', 'Documents by Author', 'Organize documents by author and year (e.g. Documents/Jane Doe/2026)', 'Documents/{doc_author}/{YYYY}', 'use_fallbacks', 0);

-- ─── Organization Proposals Table ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS organization_proposals (
  id TEXT PRIMARY KEY,
  rule_id TEXT REFERENCES organization_rules(id) ON DELETE SET NULL,
  source_file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  source_path TEXT NOT NULL,
  proposed_destination TEXT NOT NULL,
  rule_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'proposed' CHECK(status IN ('proposed', 'confirmed', 'rejected', 'executed')),
  warnings_json TEXT NOT NULL DEFAULT '[]',
  metadata_snapshot_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_org_proposals_status ON organization_proposals(status);
CREATE INDEX IF NOT EXISTS idx_org_proposals_file ON organization_proposals(source_file_id);

-- ─── Schema Version Update ───────────────────────────────────────────────────

INSERT OR REPLACE INTO schema_version (version, description)
VALUES (2, 'Metadata intelligence and organization rules');
