-- Nexora — Database Schema Migration v4
-- Ensure warning_flags column on organization_proposals table

-- ─── Add warning_flags to organization_proposals Table ────────────────────────
-- This migration safely adds the warning_flags column to organization_proposals
-- for existing installations migrated from earlier schema versions (v1-v3).
ALTER TABLE organization_proposals ADD COLUMN warning_flags TEXT;

-- ─── Schema Version Update ───────────────────────────────────────────────────
INSERT OR REPLACE INTO schema_version (version, description)
VALUES (4, 'Add warning_flags column to organization_proposals');
