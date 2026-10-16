// ============================================================================
// Nexora — Watched Folders Page
// Live Windows filesystem event listeners, auto-indexing, and auto-sorting
// ============================================================================

import React, { useEffect, useState } from 'react';
import { useWatcherStore, toast } from '../store';
import { api } from '../services/api';

export const WatchedFoldersPage: React.FC = () => {
  const { watchRoots, loading, fetchWatchRoots, addWatchRoot, removeWatchRoot, toggleWatchRoot } = useWatcherStore();
  const [adding, setAdding] = useState(false);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);

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
        toast.success(`Watching "${folderName}" for real-time filesystem changes`, 'Folder Added');
      }
    } catch (err) {
      console.error('Failed to add watched folder:', err);
      toast.error(err instanceof Error ? err.message : String(err), 'Failed to Add Folder');
    } finally {
      setAdding(false);
    }
  }

  async function handleToggle(id: string, active: boolean, label: string) {
    try {
      await toggleWatchRoot(id, active);
      toast.info(active ? `Monitoring resumed for "${label}"` : `Monitoring paused for "${label}"`, 'Watcher Updated');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err), 'Update Failed');
    }
  }

  async function handleRemove(id: string, label: string) {
    try {
      await removeWatchRoot(id);
      setConfirmRemoveId(null);
      toast.info(`Watched folder "${label}" removed. Existing indexed metadata is preserved.`, 'Watcher Removed');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err), 'Removal Failed');
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
          {adding ? 'Adding...' : '+ Add Folder to Watch'}
        </button>
      </div>

      {loading && watchRoots.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon animate-pulse">👁</div>
          <div className="empty-title">Loading watched directories...</div>
        </div>
      ) : watchRoots.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">📁</div>
          <div className="empty-title">No watched folders configured</div>
          <div className="empty-description">
            Watched folders are monitored for filesystem events (create, rename, delete).
            When new media arrives in these folders, Nexora automatically indexes metadata and extracts thumbnails.
          </div>
          <button className="btn btn-secondary" onClick={handleBrowseAndAdd}>
            Choose Folder to Watch
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          {watchRoots.map(root => (
            <div key={root.id} className="card" style={{ padding: 'var(--space-4)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                  <span style={{ fontSize: '1.8rem' }}>📂</span>
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
                    onClick={() => handleToggle(root.id, !root.active, root.label)}
                  >
                    {root.active ? 'Pause Watch' : 'Resume'}
                  </button>

                  {confirmRemoveId === root.id ? (
                    <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                      <span style={{ fontSize: '11px', color: 'var(--color-error)' }}>Remove?</span>
                      <button
                        className="btn btn-sm"
                        style={{ background: 'var(--color-error)', color: '#fff', fontSize: '11px', padding: '2px 8px' }}
                        onClick={() => handleRemove(root.id, root.label)}
                      >
                        Yes
                      </button>
                      <button
                        className="btn btn-sm btn-ghost"
                        style={{ fontSize: '11px', padding: '2px 8px' }}
                        onClick={() => setConfirmRemoveId(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      className="btn btn-sm btn-ghost"
                      style={{ color: 'var(--color-error)' }}
                      onClick={() => setConfirmRemoveId(root.id)}
                    >
                      Remove
                    </button>
                  )}
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
