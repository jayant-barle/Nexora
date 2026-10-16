// ============================================================================
// AI File Manager — Standalone DB Migration Runner
// ============================================================================

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

function runMigrations() {
  const dbDir = path.join(process.cwd(), '.data');
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  const dbPath = process.env.DB_PATH || path.join(dbDir, 'ai-file-manager.db');
  console.log(`[Migrate] Target database: ${dbPath}`);

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Check version
  const hasVersionTable = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'"
  ).get();

  let currentVersion = 0;
  if (hasVersionTable) {
    const row = db.prepare('SELECT MAX(version) as version FROM schema_version').get();
    currentVersion = row ? row.version : 0;
  }
  console.log(`[Migrate] Current database version: ${currentVersion}`);

  const migrationsDir = path.join(__dirname, '..', 'database', 'migrations');
  if (!fs.existsSync(migrationsDir)) {
    console.warn(`[Migrate] Migrations directory not found at ${migrationsDir}`);
    return;
  }

  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  let appliedCount = 0;
  for (const file of files) {
    const match = file.match(/^(\d+)/);
    if (!match) continue;

    const version = parseInt(match[1], 10);
    if (version <= currentVersion) {
      console.log(`[Migrate] Skipping ${file} (already applied)`);
      continue;
    }

    console.log(`[Migrate] Applying ${file}...`);
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
    db.exec(sql);
    appliedCount++;
    console.log(`[Migrate] Successfully applied ${file}`);
  }

  console.log(`[Migrate] Complete! Applied ${appliedCount} migration(s).`);
  db.close();
}

try {
  runMigrations();
} catch (err) {
  console.error('[Migrate] Error running migrations:', err);
  process.exit(1);
}
