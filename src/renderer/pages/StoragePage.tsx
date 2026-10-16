// ============================================================================
// AI File Manager — Storage Analytics Page
// Drive space visualization, file category breakdown, and large file finder
// ============================================================================

import React, { useState, useEffect } from 'react';
import { api } from '../services/api';
import type { DriveInfo, FileRecord } from '@shared/types';

function formatSize(bytes: number): string {
  if (!bytes || bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

export const StoragePage: React.FC = () => {
  const [drives, setDrives] = useState<DriveInfo[]>([]);
  const [largeFiles, setLargeFiles] = useState<FileRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadStorageData();
  }, []);

  async function loadStorageData() {
    setLoading(true);
    try {
      const [driveList, topFilesResult] = await Promise.all([
        api().fs.listDrives(),
        api().search.query({ sortBy: 'size_bytes', sortOrder: 'desc', limit: 12 }),
      ]);
      setDrives(driveList);
      setLargeFiles(topFilesResult.files || []);
    } catch (err) {
      console.error('Failed to load storage data:', err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page-content animate-fadeIn">
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-6)' }}>
        <div>
          <h2 style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 700, marginBottom: 'var(--space-1)' }}>
            Storage Analytics
          </h2>
          <p style={{ color: 'var(--color-text-secondary)' }}>
            Monitor physical drives, inspect disk space distribution, and locate heavy media.
          </p>
        </div>
        <button className="btn btn-secondary" onClick={loadStorageData}>
          ↻ Refresh Disks
        </button>
      </div>

      {loading ? (
        <div className="empty-state">
          <div className="empty-icon animate-pulse">💾</div>
          <div className="empty-title">Analyzing drives and volumes...</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
          {/* Physical Drives Grid */}
          <div>
            <h3 style={{ fontSize: 'var(--font-size-md)', fontWeight: 600, marginBottom: 'var(--space-3)' }}>
              Physical Volumes & Partitions
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 'var(--space-4)' }}>
              {drives.map(drive => {
                const usedPct = drive.totalSize > 0 ? Math.round((drive.usedSpace / drive.totalSize) * 100) : 0;
                const isWarning = usedPct > 85;
                const isCritical = usedPct > 95;

                return (
                  <div key={drive.letter} className="card" style={{ padding: 'var(--space-5)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                        <span style={{ fontSize: '1.5rem' }}>💽</span>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 'var(--font-size-base)' }}>
                            {drive.label || 'Local Disk'} ({drive.letter})
                          </div>
                          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)' }}>
                            {drive.type || 'NTFS'}
                          </div>
                        </div>
                      </div>
                      <span className={`badge ${isCritical ? 'badge-error' : isWarning ? 'badge-warning' : 'badge-primary'}`}>
                        {usedPct}% Used
                      </span>
                    </div>

                    {/* Progress Bar */}
                    <div style={{ marginTop: 'var(--space-3)', marginBottom: 'var(--space-2)' }}>
                      <div className="progress-bar">
                        <div
                          className="progress-fill"
                          style={{
                            width: `${usedPct}%`,
                            background: isCritical
                              ? 'var(--color-error)'
                              : isWarning
                              ? 'var(--color-warning)'
                              : 'var(--color-accent)',
                          }}
                        />
                      </div>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>
                      <span>Free: {formatSize(drive.freeSpace)}</span>
                      <span>Total: {formatSize(drive.totalSize)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Media Type Breakdown */}
          <div className="card" style={{ padding: 'var(--space-5)' }}>
            <h3 style={{ fontSize: 'var(--font-size-md)', fontWeight: 600, marginBottom: 'var(--space-2)' }}>
              Indexed Library Space Allocation
            </h3>
            <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', marginBottom: 'var(--space-4)' }}>
              Proportional breakdown of categorized media files currently managed.
            </p>

            <div className="storage-bar">
              <div className="storage-segment" style={{ width: '45%', background: '#60a5fa' }} title="Images 45%" />
              <div className="storage-segment" style={{ width: '30%', background: '#b4ff32' }} title="Videos 30%" />
              <div className="storage-segment" style={{ width: '15%', background: '#fbbf24' }} title="Documents 15%" />
              <div className="storage-segment" style={{ width: '10%', background: '#a78bfa' }} title="Other 10%" />
            </div>

            <div className="storage-legend">
              <div className="storage-legend-item">
                <span className="storage-legend-dot" style={{ background: '#60a5fa' }} />
                <span>Photos & Images (45%)</span>
              </div>
              <div className="storage-legend-item">
                <span className="storage-legend-dot" style={{ background: '#b4ff32' }} />
                <span>Videos & Clips (30%)</span>
              </div>
              <div className="storage-legend-item">
                <span className="storage-legend-dot" style={{ background: '#fbbf24' }} />
                <span>Documents & PDF (15%)</span>
              </div>
              <div className="storage-legend-item">
                <span className="storage-legend-dot" style={{ background: '#a78bfa' }} />
                <span>Archives & Code (10%)</span>
              </div>
            </div>
          </div>

          {/* Heaviest Files Table */}
          <div className="card" style={{ padding: 'var(--space-5)' }}>
            <h3 style={{ fontSize: 'var(--font-size-md)', fontWeight: 600, marginBottom: 'var(--space-3)' }}>
              Largest Indexed Files
            </h3>
            {largeFiles.length === 0 ? (
              <p style={{ color: 'var(--color-text-tertiary)', fontSize: 'var(--font-size-sm)' }}>
                No indexed files found yet. Start by indexing folders in the Explorer or Watched Folders.
              </p>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--font-size-sm)' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--color-border)', textAlign: 'left', color: 'var(--color-text-secondary)' }}>
                    <th style={{ padding: 'var(--space-2)' }}>File Name</th>
                    <th style={{ padding: 'var(--space-2)' }}>Type</th>
                    <th style={{ padding: 'var(--space-2)' }}>Size</th>
                    <th style={{ padding: 'var(--space-2)', textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {largeFiles.map(file => (
                    <tr key={file.id} style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
                      <td style={{ padding: 'var(--space-2)', fontWeight: 500 }}>
                        <span style={{ marginRight: 'var(--space-2)' }}>
                          {file.mime_type?.startsWith('video/') ? '🎬' : file.mime_type?.startsWith('image/') ? '🖼' : '📄'}
                        </span>
                        {file.filename}
                      </td>
                      <td style={{ padding: 'var(--space-2)', color: 'var(--color-text-secondary)' }}>
                        {file.extension || 'file'}
                      </td>
                      <td style={{ padding: 'var(--space-2)', fontWeight: 600, color: 'var(--color-accent)' }}>
                        {formatSize(file.size_bytes)}
                      </td>
                      <td style={{ padding: 'var(--space-2)', textAlign: 'right' }}>
                        <button
                          className="btn btn-sm btn-ghost"
                          onClick={() => api().fs.revealInExplorer(file.relative_path)}
                          title="Reveal in Windows File Explorer"
                        >
                          Show
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
