-- Nexora — Database Schema Migration v3
-- Scan Infrastructure, Root Telemetry, and Exact Duplicate Indexing

-- ─── Add Scan Telemetry Columns to Roots Table ─────────────────────────────
ALTER TABLE roots ADD COLUMN last_scanned_at TEXT;
ALTER TABLE roots ADD COLUMN scan_status TEXT NOT NULL DEFAULT 'idle';
ALTER TABLE roots ADD COLUMN file_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE roots ADD COLUMN total_size_bytes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE roots ADD COLUMN last_error TEXT;

-- ─── Add Stage Column to Jobs Table ─────────────────────────────────────────
ALTER TABLE jobs ADD COLUMN stage TEXT;

-- ─── Add Color Profile and Fingerprint to Files Table ───────────────────────
ALTER TABLE files ADD COLUMN color_profile TEXT;
ALTER TABLE files ADD COLUMN fingerprint TEXT;

-- ─── Additional Indexes for High-Speed Querying and Deduplication ────────────
CREATE INDEX IF NOT EXISTS idx_files_fingerprint ON files(fingerprint);
CREATE INDEX IF NOT EXISTS idx_files_size_bytes ON files(size_bytes);
CREATE INDEX IF NOT EXISTS idx_roots_status ON roots(scan_status);
CREATE INDEX IF NOT EXISTS idx_jobs_target_status ON jobs(type, target_path, status);

-- ─── Schema Version Update ───────────────────────────────────────────────────
INSERT OR REPLACE INTO schema_version (version, description)
VALUES (3, 'Scan infrastructure, roots telemetry, and exact duplicate indexing');
