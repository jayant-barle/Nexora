// ============================================================================
// Nexora — Electron Main Process Entry
// Secure desktop shell with contextIsolation, no nodeIntegration, and background service lifecycle
// ============================================================================

import { app, BrowserWindow, Menu } from 'electron';
import path from 'path';
import fs from 'fs';
import { initDatabase, closeDatabase } from './database';
import { registerIpcHandlers } from './ipc-handlers';
import { getAiWorkerClient } from './ai-worker-client';
import { getJobRunner } from './job-runner';
import { getWatcherService } from './watcher';

let mainWindow: BrowserWindow | null = null;

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    title: 'Nexora — AI File Manager',
    backgroundColor: '#0f0f0f',
    show: false,
    frame: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });

  // Remove default menu in production
  if (!isDev) {
    Menu.setApplicationMenu(null);
  }

  // Load the app
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  }

  // Show when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ─── App Lifecycle ───────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  // 1. Initialize SQLite database
  const legacyDb = path.join(app.getPath('userData'), 'ai-file-manager.db');
  const dbPath = fs.existsSync(legacyDb)
    ? legacyDb
    : path.join(app.getPath('userData'), 'nexora.db');
  console.log(`Database path: ${dbPath}`);
  initDatabase(dbPath);

  // 2. Register IPC handlers
  registerIpcHandlers();

  // 3. Start Python AI inference worker
  try {
    const aiWorker = getAiWorkerClient();
    aiWorker.start().catch((err) => {
      console.warn('[Main] AI Worker startup warning:', err);
    });
  } catch (err) {
    console.warn('[Main] Failed to initialize AI Worker:', err);
  }

  // 4. Start Background Job Runner
  try {
    const jobRunner = getJobRunner();
    jobRunner.start();
  } catch (err) {
    console.warn('[Main] Failed to initialize Job Runner:', err);
  }

  // 5. Initialize Chokidar Watcher Service
  try {
    const watcherService = getWatcherService();
    watcherService.init().catch((err) => {
      console.warn('[Main] Watcher Service startup warning:', err);
    });
  } catch (err) {
    console.warn('[Main] Failed to initialize Watcher Service:', err);
  }

  // 6. Create main window
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

function cleanupServices(): void {
  try {
    getJobRunner().stop();
  } catch {}
  try {
    getWatcherService().stopAll();
  } catch {}
  try {
    getAiWorkerClient().stop();
  } catch {}
  try {
    closeDatabase();
  } catch {}
}

app.on('window-all-closed', () => {
  cleanupServices();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  cleanupServices();
});

// ─── Security: Prevent new window creation & lockdown navigation ─────────────

app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(() => {
    return { action: 'deny' };
  });

  // Prevent navigation to external URLs
  contents.on('will-navigate', (event, url) => {
    if (isDev && url.startsWith('http://localhost:')) return;
    event.preventDefault();
  });
});
