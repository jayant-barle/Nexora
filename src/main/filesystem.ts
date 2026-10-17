// ============================================================================
// Nexora — Filesystem Service
// Handles file/folder operations in the main process
// ============================================================================

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { DirectoryEntry, DirectoryListResult, DriveInfo } from '../shared/types';

// ─── Drive Detection (Windows) ───────────────────────────────────────────────

export function listDrives(): DriveInfo[] {
  // Fast native probe via fs.statfsSync across Windows drive letters (safe, zero shell injection, WMIC-independent)
  const candidateLetters = ['C:', 'D:', 'E:', 'F:', 'G:', 'H:', 'I:', 'J:', 'K:', 'L:', 'M:', 'N:', 'O:', 'P:', 'Q:', 'R:', 'S:', 'T:', 'U:', 'V:', 'W:', 'X:', 'Y:', 'Z:'];
  const drives: DriveInfo[] = [];

  for (const letter of candidateLetters) {
    try {
      const letterPath = letter + '\\';
      fs.accessSync(letterPath, fs.constants.R_OK);
      let totalSize = 0;
      let freeSpace = 0;
      try {
        const stats = fs.statfsSync(letterPath);
        totalSize = stats.blocks * stats.bsize;
        freeSpace = stats.bavail * stats.bsize;
      } catch {}

      drives.push({
        letter,
        label: letter === 'C:' ? 'System Disk (C:)' : `Local Disk (${letter})`,
        type: 'Local Disk',
        totalSize,
        freeSpace,
        usedSpace: Math.max(0, totalSize - freeSpace),
      });
    } catch {
      // Drive letter not mounted or not accessible
    }
  }

  if (drives.length > 0) {
    return drives;
  }

  // POSIX / Non-Windows fallback
  try {
    const stats = fs.statfsSync('/');
    const totalSize = stats.blocks * stats.bsize;
    const freeSpace = stats.bavail * stats.bsize;
    return [{
      letter: '/',
      label: 'Root',
      type: 'Local Disk',
      totalSize,
      freeSpace,
      usedSpace: Math.max(0, totalSize - freeSpace),
    }];
  } catch {
    return [];
  }
}

// ─── Directory Listing ───────────────────────────────────────────────────────

export function listDirectory(dirPath: string, options?: { showHidden?: boolean; sortBy?: string; sortOrder?: string }): DirectoryListResult {
  try {
    const normalizedPath = path.normalize(dirPath);
    
    // Check access
    fs.accessSync(normalizedPath, fs.constants.R_OK);

    const items = fs.readdirSync(normalizedPath, { withFileTypes: true });
    const entries: DirectoryEntry[] = [];

    for (const item of items) {
      try {
        const fullPath = path.join(normalizedPath, item.name);
        let stats: fs.Stats;
        
        try {
          stats = fs.statSync(fullPath);
        } catch {
          // Can't stat this entry, skip
          continue;
        }

        const entry: DirectoryEntry = {
          name: item.name,
          path: fullPath,
          isDirectory: item.isDirectory(),
          isFile: item.isFile(),
          size: stats.size,
          modified: stats.mtime.toISOString(),
          created: stats.birthtime.toISOString(),
          extension: item.isFile() ? path.extname(item.name).toLowerCase() : '',
          isHidden: item.name.startsWith('.'),
          isSystem: false,
          isReadOnly: false,
        };

        // Check Windows hidden/system attributes
        try {
          const mode = stats.mode;
          entry.isReadOnly = !(mode & 0o200);
        } catch {
          // Attribute check failed
        }

        if (!options?.showHidden && entry.isHidden) continue;

        entries.push(entry);
      } catch {
        // Skip inaccessible entries
      }
    }

    // Sort entries: directories first, then by selected criteria
    entries.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      
      const sortBy = options?.sortBy || 'name';
      const order = options?.sortOrder === 'desc' ? -1 : 1;
      
      switch (sortBy) {
        case 'size': return (a.size - b.size) * order;
        case 'modified': return (new Date(a.modified).getTime() - new Date(b.modified).getTime()) * order;
        case 'extension': return a.extension.localeCompare(b.extension) * order;
        default: return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) * order;
      }
    });

    return { path: normalizedPath, entries, totalCount: entries.length };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error accessing directory';
    return { path: dirPath, entries: [], totalCount: 0, error: errorMsg };
  }
}

// ─── File Info ───────────────────────────────────────────────────────────────

export function getFileInfo(filePath: string): DirectoryEntry | null {
  try {
    const stats = fs.statSync(filePath);
    return {
      name: path.basename(filePath),
      path: filePath,
      isDirectory: stats.isDirectory(),
      isFile: stats.isFile(),
      size: stats.size,
      modified: stats.mtime.toISOString(),
      created: stats.birthtime.toISOString(),
      extension: path.extname(filePath).toLowerCase(),
      isHidden: path.basename(filePath).startsWith('.'),
      isSystem: false,
      isReadOnly: !(stats.mode & 0o200),
    };
  } catch {
    return null;
  }
}

// ─── MIME Type Helpers ───────────────────────────────────────────────────────

const MIME_MAP: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.gif': 'image/gif', '.bmp': 'image/bmp', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.tiff': 'image/tiff', '.tif': 'image/tiff',
  '.heic': 'image/heic', '.heif': 'image/heif', '.ico': 'image/x-icon',
  '.mp4': 'video/mp4', '.avi': 'video/x-msvideo', '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska', '.wmv': 'video/x-ms-wmv', '.flv': 'video/x-flv',
  '.webm': 'video/webm', '.m4v': 'video/x-m4v', '.3gp': 'video/3gpp',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.flac': 'audio/flac',
  '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.wma': 'audio/x-ms-wma',
  '.pdf': 'application/pdf', '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.txt': 'text/plain', '.csv': 'text/csv', '.json': 'application/json',
  '.xml': 'text/xml', '.html': 'text/html', '.md': 'text/markdown',
  '.zip': 'application/zip', '.rar': 'application/vnd.rar',
  '.7z': 'application/x-7z-compressed',
};

export function getMimeType(ext: string): string {
  return MIME_MAP[ext.toLowerCase()] || 'application/octet-stream';
}

export function isImageFile(ext: string): boolean {
  const mimeType = getMimeType(ext);
  return mimeType.startsWith('image/');
}

export function isVideoFile(ext: string): boolean {
  const mimeType = getMimeType(ext);
  return mimeType.startsWith('video/');
}

export function isMediaFile(ext: string): boolean {
  return isImageFile(ext) || isVideoFile(ext);
}

// ─── Safe File Operations ────────────────────────────────────────────────────

export function safeCopyFile(src: string, dest: string): { success: boolean; error?: string } {
  try {
    // Validate source exists
    if (!fs.existsSync(src)) {
      return { success: false, error: 'Source file does not exist' };
    }

    // Create destination directory
    const destDir = path.dirname(dest);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    // Check if destination already exists
    if (fs.existsSync(dest)) {
      return { success: false, error: 'Destination file already exists' };
    }

    // Copy to temp file first
    const tempDest = dest + '.tmp';
    fs.copyFileSync(src, tempDest);

    // Verify size
    const srcStats = fs.statSync(src);
    const tmpStats = fs.statSync(tempDest);
    if (srcStats.size !== tmpStats.size) {
      fs.unlinkSync(tempDest);
      return { success: false, error: 'Copy verification failed: size mismatch' };
    }

    // Rename temp to final
    fs.renameSync(tempDest, dest);

    return { success: true };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown copy error';
    return { success: false, error: errorMsg };
  }
}

export function getFreeDiskSpace(targetPath: string): number {
  try {
    const root = path.parse(targetPath).root || targetPath;
    if (typeof fs.statfsSync === 'function') {
      const stats = fs.statfsSync(root);
      return stats.bavail * stats.bsize;
    }
  } catch {
    // Statfs failed or path inaccessible
  }
  return 0;
}

export function createFolder(parentDir: string, folderName: string): { success: boolean; path?: string; error?: string } {
  try {
    const cleanName = folderName.trim();
    if (!cleanName || /[\\/:*?"<>|]/.test(cleanName)) {
      return { success: false, error: 'Folder name contains invalid characters: \\ / : * ? " < > |' };
    }
    const targetPath = path.join(parentDir, cleanName);
    if (fs.existsSync(targetPath)) {
      return { success: false, error: `Folder "${cleanName}" already exists` };
    }
    fs.mkdirSync(targetPath, { recursive: true });
    return { success: true, path: targetPath };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function renameEntry(oldPath: string, newName: string): { success: boolean; newPath?: string; error?: string } {
  try {
    const cleanName = newName.trim();
    if (!cleanName || /[\\/:*?"<>|]/.test(cleanName)) {
      return { success: false, error: 'Name contains invalid characters: \\ / : * ? " < > |' };
    }
    if (!fs.existsSync(oldPath)) {
      return { success: false, error: 'Target item does not exist' };
    }
    const dir = path.dirname(oldPath);
    const newPath = path.join(dir, cleanName);
    if (fs.existsSync(newPath) && newPath.toLowerCase() !== oldPath.toLowerCase()) {
      return { success: false, error: `An item named "${cleanName}" already exists` };
    }
    fs.renameSync(oldPath, newPath);
    return { success: true, newPath };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function validateSafePath(inputPath: unknown): { valid: boolean; normalized?: string; error?: string } {
  if (typeof inputPath !== 'string' || inputPath.trim().length === 0) {
    return { valid: false, error: 'Path must be a non-empty string' };
  }
  if (inputPath.includes('\0')) {
    return { valid: false, error: 'Path contains invalid null bytes' };
  }
  try {
    const normalized = path.normalize(inputPath.trim());
    return { valid: true, normalized };
  } catch (err) {
    return { valid: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function computeFileHashStream(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath, { highWaterMark: 1024 * 1024 });

      stream.on('data', (chunk) => {
        hash.update(chunk);
      });

      stream.on('end', () => {
        resolve(hash.digest('hex'));
      });

      stream.on('error', (err) => {
        reject(err);
      });
    } catch (err) {
      reject(err);
    }
  });
}


