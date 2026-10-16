// ============================================================================
// Nexora — Watched Folders Page
// Live Windows filesystem event listeners, auto-indexing, and auto-sorting
// ============================================================================

import React, { useEffect, useState } from 'react';
import { useWatcherStore } from '../store';
import { api } from '../services/api';

export const WatchedFoldersPage: React.FC = () => {
  const { watchRoots, loading, fetchWatchRoots, addWatchRoot, removeWatchRoot, toggleWatchRoot } = useWatcherStore();
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    fetchWatchRoots();
  }, [fetchWatchRoots]);

  async function handleBrowseAndAdd() {
    setAdding(true);
    try {
      const selectedFolder = await api().dialog.openFolder();
      if (selectedFolder) {
        const folderName = selectedFolder.split(/[\\/]/).filter(Boolean).pop() || 'Watched Folder';
        await addWatchRoot(selectedFolder, folderName);
      }
    } catch (err) {
      console.error('Failed to add watched folder:', err);
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="page-content animate-fadeIn">
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-6)' }}>
        <div>
          <h2 style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 700, marginBottom: 'var(--space-1)' }}>
            Watched Folders
          </h2>
          <p style={{ color: 'var(--color-text-secondary)' }}>
            Monitored directories with live filesystem changes. Newly added photos and videos are automatically indexed.
          </p>
        </div>

        <button
          className="btn btn-primary"
          onClick={handleBrowseAndAdd}
          disabled={adding}
        >
          {adding ? 'Selecting...' : '+ Add Folder to Watch'}
        </button>
      </div>

      {loading && watchRoots.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon animate-pulse">👁</div>
          <div className="empty-title">Loading watched folders...</div>
        </div>
      ) : watchRoots.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">📁</div>
          <div className="empty-title">No watched folders configured</div>
          <div className="empty-description">
            Add a folder (such as your Pictures, Downloads, or Camera SD card) to enable continuous background scanning, thumbnail creation, and AI facial recognition.
          </div>
          <button className="btn btn-primary" onClick={handleBrowseAndAdd} style={{ marginTop: 'var(--space-3)' }}>
            + Select Folder
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {watchRoots.map(root => (
            <div key={root.id} className="card" style={{ padding: 'var(--space-5)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                  <span style={{ fontSize: '1.75rem' }}>📁</span>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                      <span style={{ fontWeight: 600, fontSize: 'var(--font-size-md)' }}>{root.label}</span>
                      <span className={`badge ${root.active ? 'badge-success' : 'badge-secondary'}`}>
                        {root.active ? 'Active Watcher' : 'Paused'}
                      </span>
                    </div>
                    <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)', marginTop: '2px', fontFamily: 'var(--font-mono)' }}>
                      {root.path}
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                  <button
                    className={`btn btn-sm ${root.active ? 'btn-ghost' : 'btn-secondary'}`}
                    onClick={() => toggleWatchRoot(root.id, !root.active)}
                  >
                    {root.active ? 'Pause Watch' : 'Resume'}
                  </button>

                  <button
                    className="btn btn-sm btn-ghost"
                    style={{ color: 'var(--color-error)' }}
                    onClick={() => {
                      if (confirm(`Remove watched folder "${root.label}"? Existing indexed metadata will be preserved.`)) {
                        removeWatchRoot(root.id);
                      }
                    }}
                  >
                    Remove
                  </button>
                </div>
              </div>

              {/* Sub-settings */}
              <div style={{ display: 'flex', gap: 'var(--space-6)', marginTop: 'var(--space-4)', paddingTop: 'var(--space-3)', borderTop: '1px solid var(--color-border-subtle)', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', cursor: 'pointer' }}>
                  <input type="checkbox" defaultChecked={root.auto_index} disabled />
                  <span>Auto-index new files</span>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', cursor: 'pointer' }}>
                  <input type="checkbox" defaultChecked={root.auto_organize} disabled />
                  <span>Auto-organize into library</span>
                </label>
                {root.last_scan_at && (
                  <span style={{ marginLeft: 'auto', color: 'var(--color-text-tertiary)' }}>
                    Last scan: {new Date(root.last_scan_at).toLocaleString()}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
