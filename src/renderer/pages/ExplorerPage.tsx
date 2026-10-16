// ============================================================================
// Nexora — File Explorer Page
// ============================================================================

import React, { useEffect, useCallback } from 'react';
import { useExplorerStore } from '../store';
import { api } from '../services/api';

function formatSize(bytes: number): string {
  if (bytes === 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

function formatDate(iso: string): string {
  try { return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  catch { return iso; }
}

function getFileIcon(entry: { isDirectory: boolean; extension: string }): string {
  if (entry.isDirectory) return '📁';
  const ext = entry.extension.toLowerCase();
  if (['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg', '.heic'].includes(ext)) return '🖼';
  if (['.mp4', '.avi', '.mov', '.mkv', '.wmv', '.webm'].includes(ext)) return '🎬';
  if (['.mp3', '.wav', '.flac', '.aac', '.ogg'].includes(ext)) return '🎵';
  if (['.pdf'].includes(ext)) return '📕';
  if (['.doc', '.docx', '.txt', '.md', '.rtf'].includes(ext)) return '📄';
  if (['.xls', '.xlsx', '.csv'].includes(ext)) return '📊';
  if (['.zip', '.rar', '.7z', '.tar', '.gz'].includes(ext)) return '📦';
  if (['.exe', '.msi'].includes(ext)) return '⚙';
  if (['.js', '.ts', '.py', '.html', '.css', '.json'].includes(ext)) return '💻';
  return '📄';
}

export const ExplorerPage: React.FC = () => {
  const {
    currentPath, entries, drives, selectedFiles, viewMode, loading, error,
    navigateTo, loadDrives, toggleSelection, clearSelection, setViewMode,
    goBack, goForward, goUp, history, historyIndex,
  } = useExplorerStore();

  useEffect(() => {
    loadDrives();
  }, [loadDrives]);

  const handleEntryClick = useCallback((entry: typeof entries[0]) => {
    if (entry.isDirectory) {
      navigateTo(entry.path);
    } else {
      toggleSelection(entry.path);
    }
  }, [navigateTo, toggleSelection]);

  const handleEntryDoubleClick = useCallback((entry: typeof entries[0]) => {
    if (entry.isFile) {
      api().fs.openFile(entry.path);
    }
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent, entry: typeof entries[0]) => {
    e.preventDefault();
    // Context menu will be expanded later
    if (entry.isFile) {
      api().fs.revealInExplorer(entry.path);
    }
  }, []);

  // Build breadcrumbs
  const breadcrumbs = currentPath
    ? currentPath.split(/[\\/]/).filter(Boolean).reduce<{ label: string; path: string }[]>((acc, part, i) => {
        const prevPath = i > 0 ? acc[i - 1].path : '';
        acc.push({ label: part, path: prevPath + part + '\\' });
        return acc;
      }, [])
    : [];

  return (
    <div className="page-content" style={{ padding: 0, display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Toolbar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
        padding: 'var(--space-3) var(--space-4)',
        borderBottom: '1px solid var(--color-border-subtle)',
        flexShrink: 0,
      }}>
        <button className="btn btn-ghost btn-sm" onClick={goBack} disabled={historyIndex <= 0} title="Back">←</button>
        <button className="btn btn-ghost btn-sm" onClick={goForward} disabled={historyIndex >= history.length - 1} title="Forward">→</button>
        <button className="btn btn-ghost btn-sm" onClick={goUp} disabled={!currentPath} title="Up">↑</button>

        <div className="breadcrumbs" style={{ flex: 1 }}>
          <span className="breadcrumb-item" onClick={() => { clearSelection(); useExplorerStore.getState().setPath(''); }}>
            🖥 This PC
          </span>
          {breadcrumbs.map((crumb, i) => (
            <React.Fragment key={crumb.path}>
              <span className="breadcrumb-sep">›</span>
              <span
                className={`breadcrumb-item ${i === breadcrumbs.length - 1 ? 'active' : ''}`}
                onClick={() => navigateTo(crumb.path)}
              >
                {crumb.label}
              </span>
            </React.Fragment>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
          <button
            className={`btn btn-ghost btn-sm ${viewMode === 'grid' ? 'active' : ''}`}
            onClick={() => setViewMode('grid')}
            title="Grid view"
            style={viewMode === 'grid' ? { background: 'var(--color-accent-dim)', color: 'var(--color-accent)' } : {}}
          >⊞</button>
          <button
            className={`btn btn-ghost btn-sm ${viewMode === 'list' ? 'active' : ''}`}
            onClick={() => setViewMode('list')}
            title="List view"
            style={viewMode === 'list' ? { background: 'var(--color-accent-dim)', color: 'var(--color-accent)' } : {}}
          >≡</button>
        </div>
      </div>

      {/* Content Area */}
      <div style={{ flex: 1, overflow: 'auto', padding: 'var(--space-4)' }}>
        {loading ? (
          <div className="empty-state">
            <div className="empty-icon animate-pulse">📂</div>
            <div className="empty-title">Loading...</div>
          </div>
        ) : error ? (
          <div className="empty-state">
            <div className="empty-icon">🚫</div>
            <div className="empty-title">Access Denied</div>
            <div className="empty-description">{error}</div>
            <button className="btn btn-secondary" onClick={goUp}>Go Up</button>
          </div>
        ) : !currentPath ? (
          /* Drive view */
          <div>
            <h3 style={{ fontSize: 'var(--font-size-md)', fontWeight: 600, marginBottom: 'var(--space-4)', color: 'var(--color-text-secondary)' }}>
              Drives
            </h3>
            <div className="stats-grid">
              {drives.map(drive => {
                const usedPercent = drive.totalSize > 0 ? (drive.usedSpace / drive.totalSize) * 100 : 0;
                return (
                  <div
                    key={drive.letter}
                    className="stat-card"
                    onClick={() => navigateTo(drive.letter + '\\')}
                    style={{ cursor: 'pointer' }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                      <span style={{ fontSize: 'var(--font-size-xl)' }}>💿</span>
                      <div>
                        <div style={{ fontWeight: 600 }}>{drive.label || drive.letter}</div>
                        <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)' }}>{drive.letter}</div>
                      </div>
                    </div>
                    {drive.totalSize > 0 && (
                      <>
                        <div className="progress-bar" style={{ marginTop: 'var(--space-2)' }}>
                          <div
                            className="progress-fill"
                            style={{
                              width: `${usedPercent}%`,
                              background: usedPercent > 90 ? 'var(--color-error)' : usedPercent > 70 ? 'var(--color-warning)' : 'var(--color-accent)',
                            }}
                          />
                        </div>
                        <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)' }}>
                          {formatSize(drive.freeSpace)} free of {formatSize(drive.totalSize)}
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ) : entries.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">📂</div>
            <div className="empty-title">Empty Folder</div>
            <div className="empty-description">This folder contains no files or folders.</div>
          </div>
        ) : viewMode === 'grid' ? (
          <div className="file-grid">
            {entries.map(entry => (
              <div
                key={entry.path}
                className={`file-card ${selectedFiles.has(entry.path) ? 'selected' : ''}`}
                onClick={() => handleEntryClick(entry)}
                onDoubleClick={() => handleEntryDoubleClick(entry)}
                onContextMenu={(e) => handleContextMenu(e, entry)}
                role="button"
                tabIndex={0}
                title={entry.name}
              >
                <div className="file-icon">{getFileIcon(entry)}</div>
                <div className="file-name">{entry.name}</div>
                <div className="file-meta">
                  {entry.isFile ? formatSize(entry.size) : ''}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="file-list">
            <div className="file-list-header">
              <span>Name</span>
              <span>Size</span>
              <span>Modified</span>
              <span>Type</span>
            </div>
            {entries.map(entry => (
              <div
                key={entry.path}
                className={`file-list-item ${selectedFiles.has(entry.path) ? 'selected' : ''}`}
                onClick={() => handleEntryClick(entry)}
                onDoubleClick={() => handleEntryDoubleClick(entry)}
                onContextMenu={(e) => handleContextMenu(e, entry)}
                role="row"
                tabIndex={0}
              >
                <div className="file-list-name">
                  <span style={{ flexShrink: 0 }}>{getFileIcon(entry)}</span>
                  <span>{entry.name}</span>
                </div>
                <span style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)' }}>
                  {entry.isFile ? formatSize(entry.size) : '—'}
                </span>
                <span style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)' }}>
                  {formatDate(entry.modified)}
                </span>
                <span style={{ color: 'var(--color-text-tertiary)', fontSize: 'var(--font-size-sm)' }}>
                  {entry.isDirectory ? 'Folder' : entry.extension || 'File'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Status Bar */}
      <div style={{
        padding: 'var(--space-1) var(--space-4)',
        borderTop: '1px solid var(--color-border-subtle)',
        fontSize: 'var(--font-size-xs)',
        color: 'var(--color-text-tertiary)',
        display: 'flex',
        justifyContent: 'space-between',
        flexShrink: 0,
      }}>
        <span>{entries.length} items {selectedFiles.size > 0 ? `• ${selectedFiles.size} selected` : ''}</span>
        <span>{currentPath || 'This PC'}</span>
      </div>
    </div>
  );
};
