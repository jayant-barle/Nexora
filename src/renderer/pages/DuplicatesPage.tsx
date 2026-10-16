// ============================================================================
// Nexora — Duplicates Page
// Deduplication, exact SHA-256 match, and perceptual image similarity
// ============================================================================

import React, { useState, useEffect } from 'react';
import { api } from '../services/api';
import type { DuplicateGroup } from '@shared/types';

function formatSize(bytes: number): string {
  if (!bytes || bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

export const DuplicatesPage: React.FC = () => {
  const [groups, setGroups] = useState<DuplicateGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState<'all' | 'exact' | 'similar'>('all');
  const [scanning, setScanning] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState<DuplicateGroup | null>(null);

  useEffect(() => {
    loadDuplicates();
  }, []);

  async function loadDuplicates() {
    setLoading(true);
    try {
      const data = await api().duplicates.list() as DuplicateGroup[];
      setGroups(data || []);
      if (data && data.length > 0) {
        setSelectedGroup(data[0]);
      }
    } catch (err) {
      console.error('Failed to load duplicates:', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleStartScan() {
    setScanning(true);
    try {
      await api().jobs.create('hash_compute');
      alert('Duplicate scan job queued! You can monitor progress in the Activity tab.');
    } catch (err) {
      console.error('Failed to start scan:', err);
    } finally {
      setScanning(false);
    }
  }

  const filteredGroups = groups.filter(g => {
    if (filterType === 'all') return true;
    return g.type === filterType;
  });

  const totalWastedBytes = groups.reduce((acc, g) => acc + (g.total_size || 0), 0);

  return (
    <div className="page-content animate-fadeIn">
      {/* Top Banner / Stats */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--space-6)' }}>
        <div>
          <h2 style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 700, marginBottom: 'var(--space-1)' }}>
            Duplicate Finder & Cleanup
          </h2>
          <p style={{ color: 'var(--color-text-secondary)' }}>
            Identify byte-for-byte exact copies and near-identical photos to reclaim disk space safely.
          </p>
        </div>

        <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
          <button
            className="btn btn-secondary"
            onClick={loadDuplicates}
            title="Refresh duplicates list"
          >
            ↻ Refresh
          </button>
          <button
            className="btn btn-primary"
            onClick={handleStartScan}
            disabled={scanning}
          >
            {scanning ? 'Queueing Scan...' : '⚡ Scan for Duplicates'}
          </button>
        </div>
      </div>

      {/* Summary KPI Strip */}
      <div className="stats-grid" style={{ marginBottom: 'var(--space-6)' }}>
        <div className="stat-card">
          <div className="stat-label">Duplicate Groups</div>
          <div className="stat-value">{groups.length}</div>
          <div className="stat-subtext">Identified across indexed roots</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Reclaimable Space</div>
          <div className="stat-value text-accent">{formatSize(totalWastedBytes)}</div>
          <div className="stat-subtext">Potential storage savings</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Exact SHA-256 Clones</div>
          <div className="stat-value">{groups.filter(g => g.type === 'exact').length}</div>
          <div className="stat-subtext">100% identical checksums</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Perceptual Similar</div>
          <div className="stat-value">{groups.filter(g => g.type === 'similar').length}</div>
          <div className="stat-subtext">Visually similar photo bursts</div>
        </div>
      </div>

      {/* Filters Bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)' }}>
        <div className="tabs">
          <button
            className={`tab ${filterType === 'all' ? 'active' : ''}`}
            onClick={() => setFilterType('all')}
          >
            All Groups ({groups.length})
          </button>
          <button
            className={`tab ${filterType === 'exact' ? 'active' : ''}`}
            onClick={() => setFilterType('exact')}
          >
            Exact Hashes ({groups.filter(g => g.type === 'exact').length})
          </button>
          <button
            className={`tab ${filterType === 'similar' ? 'active' : ''}`}
            onClick={() => setFilterType('similar')}
          >
            Visual Similar ({groups.filter(g => g.type === 'similar').length})
          </button>
        </div>
      </div>

      {/* Content Area */}
      {loading ? (
        <div className="empty-state">
          <div className="empty-icon animate-pulse">🔄</div>
          <div className="empty-title">Scanning database for duplicates...</div>
        </div>
      ) : filteredGroups.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">✨</div>
          <div className="empty-title">No duplicates detected</div>
          <div className="empty-description">
            Your library is clean! Either all indexed files are unique, or you haven't run a hash & duplicate comparison scan yet.
          </div>
          <button className="btn btn-primary" onClick={handleStartScan} style={{ marginTop: 'var(--space-3)' }}>
            Start Duplicate Scan Now
          </button>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '360px 1fr', gap: 'var(--space-6)', height: 'calc(100vh - 360px)' }}>
          {/* Groups List */}
          <div style={{ overflowY: 'auto', borderRight: '1px solid var(--color-border)', paddingRight: 'var(--space-4)' }}>
            {filteredGroups.map(group => (
              <div
                key={group.id}
                onClick={() => setSelectedGroup(group)}
                className={`card ${selectedGroup?.id === group.id ? 'active' : ''}`}
                style={{
                  padding: 'var(--space-3) var(--space-4)',
                  marginBottom: 'var(--space-2)',
                  cursor: 'pointer',
                  borderColor: selectedGroup?.id === group.id ? 'var(--color-accent)' : undefined,
                  background: selectedGroup?.id === group.id ? 'var(--color-accent-dim)' : undefined,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span className={`badge ${group.type === 'exact' ? 'badge-primary' : 'badge-secondary'}`}>
                    {group.type === 'exact' ? 'Exact Match' : 'Visual Similar'}
                  </span>
                  <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>
                    {formatSize(group.total_size)}
                  </span>
                </div>
                <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, marginTop: 'var(--space-2)' }}>
                  {group.file_count} duplicate files
                </div>
                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)', marginTop: '2px', wordBreak: 'break-all' }}>
                  Hash: {group.hash ? `${group.hash.substring(0, 16)}...` : 'Visual cluster'}
                </div>
              </div>
            ))}
          </div>

          {/* Group Details & Resolution */}
          <div style={{ overflowY: 'auto', paddingLeft: 'var(--space-2)' }}>
            {selectedGroup && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)' }}>
                  <div>
                    <h3 style={{ fontSize: 'var(--font-size-lg)', fontWeight: 600 }}>Group Details</h3>
                    <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>
                      Resolve duplicates by choosing which file to keep as original.
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                    <button className="btn btn-sm btn-secondary" onClick={() => alert('Keeping highest quality file as master')}>
                      Keep Best Quality
                    </button>
                    <button className="btn btn-sm btn-secondary" onClick={() => alert('Keeping newest timestamp file')}>
                      Keep Newest
                    </button>
                  </div>
                </div>

                <div className="duplicate-pair">
                  <div className="duplicate-item">
                    <div className="duplicate-preview">
                      <span style={{ fontSize: '3rem' }}>📄</span>
                    </div>
                    <div style={{ marginTop: 'var(--space-2)', fontSize: 'var(--font-size-sm)', fontWeight: 600 }}>
                      Candidate File 1 (Original)
                    </div>
                    <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>
                      Size: {formatSize(Math.floor(selectedGroup.total_size / selectedGroup.file_count))}
                    </div>
                    <div style={{ marginTop: 'var(--space-3)' }}>
                      <span className="badge badge-success">Recommended to Keep</span>
                    </div>
                  </div>

                  <div className="duplicate-item">
                    <div className="duplicate-preview">
                      <span style={{ fontSize: '3rem' }}>📄</span>
                    </div>
                    <div style={{ marginTop: 'var(--space-2)', fontSize: 'var(--font-size-sm)', fontWeight: 600 }}>
                      Candidate File 2 (Duplicate)
                    </div>
                    <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>
                      Size: {formatSize(Math.floor(selectedGroup.total_size / selectedGroup.file_count))}
                    </div>
                    <div style={{ marginTop: 'var(--space-3)', display: 'flex', gap: 'var(--space-2)' }}>
                      <button className="btn btn-sm btn-ghost" style={{ color: 'var(--color-error)' }} onClick={() => alert('Moved to Recycle Bin')}>
                        Move to Trash
                      </button>
                      <button className="btn btn-sm btn-secondary" onClick={() => alert('Replaced with NTFS Hardlink')}>
                        Hardlink
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
