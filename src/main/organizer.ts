// ============================================================================
// Nexora — Metadata-Based Organization & Preview Engine
// Proposes and executes safe, copy-first media organization based on metadata rules
// ============================================================================

import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from './database';
import { computeFileSha256, resolveSafeDestinationPath, executeBatchCopyOperation, OperationResult, CopyItem } from './file-operations';
import type { OrganizationRule, OrganizationProposalItem, OrganizationPreviewSummary } from '../shared/types';

export interface GenerateProposalsOptions {
  fileIds?: string[];
  rootId?: string;
  rulePattern?: string;
  ruleName?: string;
  destinationRoot: string;
}

// ─── Format Category Helper ──────────────────────────────────────────────────

export function getFileCategory(ext: string): string {
  const e = ext.toLowerCase();
  if (['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.tiff', '.gif', '.heic', '.heif', '.raw', '.cr2', '.nef', '.arw', '.dng'].includes(e)) {
    return 'Images';
  }
  if (['.mp4', '.avi', '.mov', '.mkv', '.wmv', '.webm', '.m4v', '.flv', '.3gp'].includes(e)) {
    return 'Videos';
  }
  if (['.pdf', '.docx', '.pptx', '.xlsx', '.doc', '.ppt', '.xls', '.odt', '.ods'].includes(e)) {
    return 'Documents';
  }
  if (['.mp3', '.wav', '.flac', '.m4a', '.aac', '.ogg', '.wma', '.opus'].includes(e)) {
    return 'Audio';
  }
  if (['.zip', '.tar', '.gz', '.tgz', '.rar', '.7z', '.bz2'].includes(e)) {
    return 'Archives';
  }
  if (['.txt', '.md', '.markdown', '.csv', '.json', '.xml', '.html', '.css', '.js', '.ts', '.py', '.sql', '.log'].includes(e)) {
    return 'Text';
  }
  return 'Other';
}

// ─── Rule Pattern Resolver ───────────────────────────────────────────────────

export function resolveOrganizationPath(
  file: any,
  pattern: string,
  personName?: string | null,
  eventName?: string | null,
  locationName?: string | null
): { relativeFolder: string; warnings: string[] } {
  const warnings: string[] = [];

  // 1. Date Resolution: Prefer EXIF capture_time, fallback to file_created_at / file_modified_at
  let year = 'Unknown Date';
  let month = 'Unknown Date';
  let day = 'Unknown Date';
  let ymd = 'Unknown Date';

  const dateStr = file.capture_time || file.file_created_at || file.file_modified_at;
  if (dateStr) {
    try {
      const d = new Date(dateStr);
      if (!isNaN(d.getTime())) {
        year = String(d.getFullYear());
        month = String(d.getMonth() + 1).padStart(2, '0');
        day = String(d.getDate()).padStart(2, '0');
        ymd = `${year}-${month}`;
      } else {
        warnings.push('Unparseable timestamp; using Unknown Date fallback');
      }
    } catch {
      warnings.push('Date parsing failed; using Unknown Date fallback');
    }
    if (!file.capture_time && (file.file_created_at || file.file_modified_at)) {
      warnings.push('EXIF capture date missing; using filesystem timestamp fallback');
    }
  } else {
    warnings.push('No date metadata available; using Unknown Date fallback');
  }

  // 2. Category Resolution
  const category = getFileCategory(file.extension || path.extname(file.filename || ''));

  // 3. Person Resolution: Never infer identity from filename; require confirmed person
  let person = 'Unassigned';
  if (personName && personName.trim() && personName.trim().toLowerCase() !== 'unassigned') {
    person = personName.trim();
  } else {
    if (pattern.includes('{person}')) {
      warnings.push('No confirmed person identity; using Unassigned fallback');
    }
  }

  // 4. Camera Resolution
  let camera = 'Unknown Camera';
  const make = file.camera_make?.trim() || '';
  const model = file.camera_model?.trim() || '';
  if (model) {
    camera = make && !model.toLowerCase().includes(make.toLowerCase()) ? `${make} ${model}` : model;
  } else if (make) {
    camera = make;
  } else {
    if (pattern.includes('{camera}')) {
      warnings.push('Camera make/model metadata absent; using Unknown Camera fallback');
    }
  }

  // 5. Location Resolution
  let loc = 'Unknown Location';
  if (locationName && locationName.trim()) {
    loc = locationName.trim();
  } else if (file.city || file.country) {
    loc = [file.city, file.country].filter(Boolean).join(', ');
  } else {
    if (pattern.includes('{location}') || pattern.includes('{city}') || pattern.includes('{country}')) {
      warnings.push('GPS/Location metadata missing; using Unknown Location fallback');
    }
  }

  // 6. Event Resolution
  let ev = 'General';
  if (eventName && eventName.trim()) {
    ev = eventName.trim();
  } else {
    if (pattern.includes('{event}')) {
      warnings.push('No event association; using General fallback');
    }
  }

  // 7. Author Resolution for documents
  let author = 'Unknown Author';
  if (file.doc_author && file.doc_author.trim()) {
    author = file.doc_author.trim();
  } else if (pattern.includes('{doc_author}') || pattern.includes('{author}')) {
    warnings.push('Document author absent; using Unknown Author fallback');
  }

  // 8. Filename & Extension Resolution for explicit user-defined filename rules
  const fullFilename = file.filename || (file.relative_path ? path.basename(file.relative_path) : 'file');
  const extWithDot = file.extension || path.extname(fullFilename);
  const extWithoutDot = extWithDot.startsWith('.') ? extWithDot.slice(1) : extWithDot;
  const baseName = fullFilename.endsWith(extWithDot)
    ? fullFilename.slice(0, -extWithDot.length)
    : path.parse(fullFilename).name;

  // Extract meaningful prefix and suffix from filename (e.g. "Family_2026_02", "Invoice_CompanyA")
  const parts = baseName.split(/[-_.]+/).filter(Boolean);
  const prefix = parts.length > 0 ? parts[0] : baseName;
  const suffix = parts.length > 1 ? parts[parts.length - 1] : baseName;
  const title = file.doc_title || file.audio_title || baseName;

  // Replace tokens in pattern
  let folder = pattern
    .replace(/\{category\}/gi, category)
    .replace(/\{YYYY\}/g, year)
    .replace(/\{MM\}/g, month)
    .replace(/\{DD\}/g, day)
    .replace(/\{YYYY-MM\}/g, ymd)
    .replace(/\{person\}/gi, person)
    .replace(/\{camera\}/gi, camera)
    .replace(/\{location\}/gi, loc)
    .replace(/\{city\}/gi, file.city || loc)
    .replace(/\{country\}/gi, file.country || loc)
    .replace(/\{event\}/gi, ev)
    .replace(/\{doc_author\}/gi, author)
    .replace(/\{author\}/gi, author)
    .replace(/\{doc_title\}/gi, title)
    .replace(/\{title\}/gi, title)
    .replace(/\{prefix\}/gi, prefix)
    .replace(/\{suffix\}/gi, suffix)
    .replace(/\{filename\}/gi, fullFilename)
    .replace(/\{basename\}/gi, baseName)
    .replace(/\{name\}/gi, baseName)
    .replace(/\{extension\}/gi, extWithoutDot || 'Other')
    .replace(/\{ext\}/gi, extWithoutDot || 'Other');

  // Ambiguity & Unresolved Token Safety Fallback:
  // If pattern has unresolved or ambiguous tokens, apply safe fallback and warn
  if (/\{[a-zA-Z0-9_-]+\}/.test(folder)) {
    warnings.push('Unresolved or ambiguous rule tokens detected; applied safe fallback');
    folder = folder.replace(/\{[a-zA-Z0-9_-]+\}/g, 'General');
  }

  // Normalize slashes
  folder = folder.replace(/[\\/]+/g, path.sep);
  return { relativeFolder: folder, warnings };
}

// ─── Generate Organization Proposals ─────────────────────────────────────────

export async function generateOrganizationProposals(
  optionsOrFileIds: GenerateProposalsOptions | string[],
  ruleIdOrPattern?: string,
  destinationRoot?: string
): Promise<OrganizationPreviewSummary> {
  const db = getDb();

  let options: GenerateProposalsOptions;
  if (Array.isArray(optionsOrFileIds)) {
    let pattern = ruleIdOrPattern || '{category}/{YYYY}/{MM}';
    let ruleName = 'Metadata Organization Rule';
    if (ruleIdOrPattern) {
      try {
        const existingRule = db.prepare('SELECT name, pattern FROM organization_rules WHERE id = ?').get(ruleIdOrPattern) as any;
        if (existingRule) {
          pattern = existingRule.pattern;
          ruleName = existingRule.name;
        }
      } catch {}
    }
    options = {
      fileIds: optionsOrFileIds,
      rulePattern: pattern,
      ruleName,
      destinationRoot: destinationRoot || '',
    };
  } else {
    options = optionsOrFileIds;
  }

  const pattern = options.rulePattern || '{category}/{YYYY}/{MM}';
  const ruleName = options.ruleName || 'Metadata Organization Rule';
  const destRoot = path.normalize(options.destinationRoot);

  // Build files query
  let sql = `
    SELECT f.*, r.path as root_path,
      (
        SELECT GROUP_CONCAT(name, ' & ')
        FROM (
          SELECT DISTINCT p.name as name
          FROM file_people fp
          JOIN people p ON fp.person_id = p.id
          WHERE fp.file_id = f.id
            AND p.is_hidden = 0
            AND p.is_excluded = 0
            AND (p.review_status IN ('confirmed', 'reviewed') OR fp.association_type = 'confirmed')
          ORDER BY p.name ASC
        )
      ) as person_name,
      (SELECT l.city FROM locations l WHERE l.file_id = f.id LIMIT 1) as city,
      (SELECT l.country FROM locations l WHERE l.file_id = f.id LIMIT 1) as country,
      (SELECT e.name FROM event_files ef JOIN events e ON ef.event_id = e.id WHERE ef.file_id = f.id LIMIT 1) as event_name
    FROM files f
    JOIN roots r ON f.root_id = r.id
    WHERE f.is_missing = 0
  `;
  const params: unknown[] = [];

  if (options.fileIds && options.fileIds.length > 0) {
    const placeholders = options.fileIds.map(() => '?').join(',');
    sql += ` AND f.id IN (${placeholders})`;
    params.push(...options.fileIds);
  } else if (options.rootId) {
    sql += ' AND f.root_id = ?';
    params.push(options.rootId);
  }

  sql += ' ORDER BY f.capture_time DESC, f.file_created_at DESC LIMIT 500';

  const rows = db.prepare(sql).all(...params) as any[];

  const proposals: OrganizationProposalItem[] = [];
  let totalBytes = 0;
  let estimatedDuplicatesAvoided = 0;
  let destinationConflicts = 0;
  let warningsCount = 0;

  for (const row of rows) {
    const sourcePath = path.join(row.root_path, row.relative_path);
    totalBytes += row.size_bytes || 0;

    const { relativeFolder, warnings } = resolveOrganizationPath(
      row,
      pattern,
      row.person_name,
      row.event_name,
      null
    );

    const proposedDestDir = path.join(destRoot, relativeFolder);
    const initialDestPath = path.join(proposedDestDir, row.filename);

    let finalDestPath = initialDestPath;
    let isIdenticalDuplicate = false;
    let hasCollision = false;

    // Check collision or duplicate at destination if destination exists
    if (fs.existsSync(initialDestPath)) {
      try {
        const collisionRes = await resolveSafeDestinationPath(initialDestPath, row.hash_sha256 || undefined);
        finalDestPath = collisionRes.finalPath;
        isIdenticalDuplicate = collisionRes.isIdenticalDuplicate;
        hasCollision = !collisionRes.isIdenticalDuplicate && collisionRes.finalPath !== initialDestPath;
      } catch {
        finalDestPath = initialDestPath;
      }
    }

    if (isIdenticalDuplicate) {
      estimatedDuplicatesAvoided++;
      warnings.push('Identical file already exists at destination; redundant copy will be safely skipped');
    } else if (hasCollision) {
      destinationConflicts++;
      warnings.push(`Destination collision detected; auto-incremented to ${path.basename(finalDestPath)} to prevent overwriting`);
    }

    if (warnings.length > 0) {
      warningsCount += warnings.length;
    }

    const proposalItem: OrganizationProposalItem = {
      id: uuidv4(),
      source_file_id: row.id,
      source_path: sourcePath,
      proposed_destination: finalDestPath,
      rule_name: ruleName,
      status: 'proposed',
      warnings,
      metadata_snapshot: {
        category: getFileCategory(row.extension || ''),
        capture_time: row.capture_time,
        camera_make: row.camera_make,
        camera_model: row.camera_model,
        person_name: row.person_name,
        doc_author: row.doc_author,
        hash_sha256: row.hash_sha256,
      },
      file_size: row.size_bytes || 0,
      is_identical_duplicate: isIdenticalDuplicate,
      has_collision: hasCollision,
    };

    proposals.push(proposalItem);
  }

  return {
    proposals,
    totalFiles: proposals.length,
    totalBytes,
    estimatedDuplicatesAvoided,
    destinationConflicts,
    warningsCount,
  };
}

// ─── Execute Verified Organization ───────────────────────────────────────────

export async function executeOrganization(
  proposalItems: Array<OrganizationProposalItem | { sourcePath: string; destinationPath: string; source_path?: string; proposed_destination?: string }>,
  destinationRoot: string,
  optionsOrRuleDesc?: string | { removeSourceOnSuccess?: boolean; ruleDescription?: string },
  onProgress?: (completed: number, total: number) => void
): Promise<OperationResult> {
  const copyItems: CopyItem[] = proposalItems.map(p => {
    const src = 'sourcePath' in p && p.sourcePath ? p.sourcePath : ('source_path' in p ? p.source_path : '');
    const dst = 'destinationPath' in p && p.destinationPath ? p.destinationPath : ('proposed_destination' in p ? p.proposed_destination : '');
    return {
      sourcePath: src || '',
      destinationPath: dst || '',
    };
  }).filter(item => item.sourcePath && item.destinationPath);

  const desc = typeof optionsOrRuleDesc === 'string'
    ? optionsOrRuleDesc
    : (optionsOrRuleDesc?.ruleDescription || 'Metadata Organization');

  return executeBatchCopyOperation(
    `Organization: ${desc}`,
    destinationRoot,
    copyItems,
    onProgress
  );
}

// ─── Rule Store Helpers ──────────────────────────────────────────────────────

export function getOrganizationRules(): OrganizationRule[] {
  const db = getDb();
  try {
    return db.prepare('SELECT * FROM organization_rules ORDER BY is_default DESC, name ASC').all() as OrganizationRule[];
  } catch {
    return [];
  }
}

export function saveOrganizationRule(rule: Partial<OrganizationRule>): OrganizationRule {
  const db = getDb();
  const id = rule.id || `rule-${uuidv4().substring(0, 8)}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO organization_rules (id, name, description, pattern, fallback_behavior, is_default, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      description = excluded.description,
      pattern = excluded.pattern,
      fallback_behavior = excluded.fallback_behavior,
      updated_at = excluded.updated_at
  `).run(
    id,
    rule.name || 'Custom Rule',
    rule.description || null,
    rule.pattern || '{category}/{YYYY}/{MM}',
    rule.fallback_behavior || 'use_fallbacks',
    rule.is_default ? 1 : 0,
    now,
    now
  );

  return db.prepare('SELECT * FROM organization_rules WHERE id = ?').get(id) as OrganizationRule;
}

// ─── Proposal Persistence & Automatic Execution Pipeline ────────────────────

export function resolveDefaultManagedLibrary(): string {
  const db = getDb();
  // 1. Check user configured setting
  const settingRow = db.prepare("SELECT value FROM app_settings WHERE key = 'managedLibraryPath'").get() as { value: string } | undefined;
  if (settingRow && settingRow.value && settingRow.value.trim()) {
    return settingRow.value.trim();
  }

  // 2. Check roots for a managed root
  const managedRoot = db.prepare("SELECT path FROM roots WHERE type = 'managed' AND active = 1 LIMIT 1").get() as { path: string } | undefined;
  if (managedRoot && managedRoot.path) {
    return managedRoot.path;
  }

  // 3. Fallback: Default safe directory inside user home/documents
  const homeDir = process.env.USERPROFILE || process.env.HOME || 'C:\\Nexora';
  return path.join(homeDir, 'Nexora Organized');
}

export function saveProposalItemsToDb(proposals: OrganizationProposalItem[], ruleId?: string | null): void {
  const db = getDb();
  const insertProposalStmt = db.prepare(`
    INSERT INTO organization_proposals (id, rule_id, source_file_id, source_path, proposed_destination, status, warning_flags, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      proposed_destination = excluded.proposed_destination,
      status = excluded.status,
      warning_flags = excluded.warning_flags
  `);

  const tx = db.transaction((items: OrganizationProposalItem[]) => {
    for (const p of items) {
      insertProposalStmt.run(
        p.id,
        ruleId ?? p.rule_id ?? null,
        p.source_file_id,
        p.source_path,
        p.proposed_destination,
        p.status,
        p.warnings && p.warnings.length > 0 ? JSON.stringify(p.warnings) : null
      );
    }
  });

  tx(proposals);
}

export function getStoredProposals(status = 'proposed', limit = 200): OrganizationProposalItem[] {
  const db = getDb();
  try {
    const rows = db.prepare(`
      SELECT op.*, f.filename, f.extension, f.size_bytes, f.capture_time, f.camera_make, f.camera_model, f.doc_author, f.hash_sha256,
             COALESCE(r.name, 'Metadata Rule') as rule_name
      FROM organization_proposals op
      JOIN files f ON op.source_file_id = f.id
      LEFT JOIN organization_rules r ON op.rule_id = r.id
      WHERE op.status = ?
      ORDER BY op.created_at DESC
      LIMIT ?
    `).all(status, limit) as any[];

    return rows.map((r) => {
      let warnings: string[] = [];
      try {
        if (r.warning_flags) warnings = JSON.parse(r.warning_flags);
      } catch {}

      return {
        id: r.id,
        rule_id: r.rule_id,
        source_file_id: r.source_file_id,
        source_path: r.source_path,
        proposed_destination: r.proposed_destination,
        rule_name: r.rule_name,
        status: r.status,
        warnings,
        metadata_snapshot: {
          category: getFileCategory(r.extension || ''),
          capture_time: r.capture_time,
          camera_make: r.camera_make,
          camera_model: r.camera_model,
          doc_author: r.doc_author,
          hash_sha256: r.hash_sha256,
        },
        file_size: r.size_bytes || 0,
      };
    });
  } catch {
    return [];
  }
}

export async function runAutoOrganizationPipeline(
  rootIdOrPath?: string,
  destinationRootOverride?: string
): Promise<{ proposalSummary: OrganizationPreviewSummary; executed: boolean; operationResult?: OperationResult }> {
  const db = getDb();

  // Find root
  let targetRootId = rootIdOrPath;
  if (rootIdOrPath) {
    const rootRow = db.prepare('SELECT id, path FROM roots WHERE id = ? OR path = ?').get(rootIdOrPath, rootIdOrPath) as any;
    if (rootRow) {
      targetRootId = rootRow.id;
    }
  }

  // Get active or default rule
  const defaultRule = db.prepare('SELECT id, name, pattern FROM organization_rules WHERE is_default = 1 LIMIT 1').get() as any
    || { id: 'rule_default_date', name: 'Date Hierarchy', pattern: '{category}/{YYYY}/{MM}' };

  const destRoot = destinationRootOverride || resolveDefaultManagedLibrary();

  // Generate proposals for files in this root
  const proposalSummary = await generateOrganizationProposals({
    rootId: targetRootId,
    rulePattern: defaultRule.pattern,
    ruleName: defaultRule.name,
    destinationRoot: destRoot,
  });

  // Save proposals to database
  saveProposalItemsToDb(proposalSummary.proposals, defaultRule.id);

  // Check user auto-organize setting
  const settings = db.prepare("SELECT value FROM app_settings WHERE key = 'autoOrganize'").get() as { value: string } | undefined;
  const isAutoOrganizeEnabled = settings?.value === 'true';

  let executed = false;
  let opResult: OperationResult | undefined;

  if (isAutoOrganizeEnabled && proposalSummary.proposals.length > 0) {
    // User authorized automatic copy execution
    opResult = await executeOrganization(
      proposalSummary.proposals,
      destRoot,
      `Automatic Organization: ${defaultRule.name}`
    );
    executed = true;

    // Mark successfully organized proposals as executed
    if (opResult.success) {
      const updateStmt = db.prepare("UPDATE organization_proposals SET status = 'executed' WHERE id = ?");
      const tx = db.transaction((proposals: OrganizationProposalItem[]) => {
        for (const p of proposals) {
          updateStmt.run(p.id);
        }
      });
      tx(proposalSummary.proposals);
    }
  }

  return {
    proposalSummary,
    executed,
    operationResult: opResult,
  };
}
