-- Nexora — Database Schema Migration v5
-- Ensure metadata_snapshot_json and rule_name columns on organization_proposals table

-- ─── Add metadata_snapshot_json and rule_name to organization_proposals Table ─
ALTER TABLE organization_proposals ADD COLUMN metadata_snapshot_json TEXT NOT NULL DEFAULT '{}';

-- ─── Schema Version Update ───────────────────────────────────────────────────
INSERT OR REPLACE INTO schema_version (version, description)
VALUES (5, 'Add metadata_snapshot_json column to organization_proposals');
