// ============================================================================
// Nexora — Dashboard Page
// ============================================================================

import React, { useEffect } from 'react';
import { useDashboardStore, useNavigationStore } from '../store';

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function formatNumber(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toString();
}

export const DashboardPage: React.FC = () => {
  const { stats, loading, error, fetchStats } = useDashboardStore();
  const { setPage } = useNavigationStore();

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 15000);
    return () => clearInterval(interval);
  }, [fetchStats]);

  if (loading && !stats) {
    return (
      <div className="page-content">
        <div className="empty-state">
          <div className="empty-icon animate-pulse">◈</div>
          <div className="empty-title">Loading Dashboard...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page-content">
        <div className="empty-state">
          <div className="empty-icon">⚠</div>
          <div className="empty-title">Error Loading Dashboard</div>
          <div className="empty-description">{error}</div>
          <button className="btn btn-primary" onClick={fetchStats}>Retry</button>
        </div>
      </div>
    );
  }

  const s = stats || {
    totalFiles: 0, totalImages: 0, totalVideos: 0, totalPeople: 0,
    reviewedPeople: 0, unreviewedPeople: 0, duplicateGroups: 0,
    activeJobs: 0, pendingJobs: 0, failedJobs: 0,
    totalIndexedSize: 0, recentActivity: [], watchedFolders: 0,
  };

  const isEmpty = s.totalFiles === 0 && s.watchedFolders === 0;

  return (
    <div className="page-content">
      <div style={{ marginBottom: 'var(--space-6)' }}>
        <h2 style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 700, marginBottom: 'var(--space-1)' }}>
          Nexora Dashboard
        </h2>
        <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-base)' }}>
          {isEmpty ? 'Your files. Your intelligence. Your control.' : 'Your media library at a glance'}
        </p>
      </div>

      {isEmpty ? (
        <div className="empty-state" style={{ paddingTop: 'var(--space-8)' }}>
          <div className="empty-icon">📂</div>
          <div className="empty-title">No folders indexed yet</div>
          <div className="empty-description">
            Start by adding folders to index. Nexora will scan your files,
            detect faces, and organize your media — all locally on your machine.
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
            <button className="btn btn-primary btn-lg" onClick={() => setPage('explorer')}>
              📁 Browse Files
            </button>
            <button className="btn btn-secondary btn-lg" onClick={() => setPage('watched')}>
              👁 Add Watched Folder
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* Stats Grid */}
          <div className="stats-grid" style={{ marginBottom: 'var(--space-6)' }}>
            <div className="stat-card" onClick={() => setPage('explorer')} style={{ cursor: 'pointer' }}>
              <div className="stat-icon" style={{ background: 'var(--color-accent-dim)', color: 'var(--color-accent)' }}>📄</div>
              <div className="stat-value">{formatNumber(s.totalFiles)}</div>
              <div className="stat-label">Total Files</div>
            </div>

            <div className="stat-card">
              <div className="stat-icon" style={{ background: 'var(--color-info-dim)', color: 'var(--color-info)' }}>🖼</div>
              <div className="stat-value">{formatNumber(s.totalImages)}</div>
              <div className="stat-label">Images</div>
            </div>

            <div className="stat-card">
              <div className="stat-icon" style={{ background: 'var(--color-warning-dim)', color: 'var(--color-warning)' }}>🎬</div>
              <div className="stat-value">{formatNumber(s.totalVideos)}</div>
              <div className="stat-label">Videos</div>
            </div>

            <div className="stat-card" onClick={() => setPage('people')} style={{ cursor: 'pointer' }}>
              <div className="stat-icon" style={{ background: 'rgba(168,85,247,0.12)', color: '#a855f7' }}>👤</div>
              <div className="stat-value">{formatNumber(s.totalPeople)}</div>
              <div className="stat-label">People ({s.unreviewedPeople} unreviewed)</div>
            </div>

            <div className="stat-card" onClick={() => setPage('duplicates')} style={{ cursor: 'pointer' }}>
              <div className="stat-icon" style={{ background: 'var(--color-error-dim)', color: 'var(--color-error)' }}>🔄</div>
              <div className="stat-value">{formatNumber(s.duplicateGroups)}</div>
              <div className="stat-label">Duplicate Groups</div>
            </div>

            <div className="stat-card" onClick={() => setPage('storage')} style={{ cursor: 'pointer' }}>
              <div className="stat-icon" style={{ background: 'var(--color-success-dim)', color: 'var(--color-success)' }}>💾</div>
              <div className="stat-value">{formatSize(s.totalIndexedSize)}</div>
              <div className="stat-label">Indexed Size</div>
            </div>
          </div>

          {/* Active Jobs */}
          {(s.activeJobs > 0 || s.pendingJobs > 0 || s.failedJobs > 0) && (
            <div className="card" style={{ marginBottom: 'var(--space-6)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-3)' }}>
                <h3 style={{ fontSize: 'var(--font-size-md)', fontWeight: 600 }}>Background Jobs</h3>
                <button className="btn btn-ghost btn-sm" onClick={() => setPage('activity')}>View All →</button>
              </div>
              <div style={{ display: 'flex', gap: 'var(--space-4)' }}>
                {s.activeJobs > 0 && (
                  <span className="job-status running">⚡ {s.activeJobs} running</span>
                )}
                {s.pendingJobs > 0 && (
                  <span className="job-status queued">⏳ {s.pendingJobs} pending</span>
                )}
                {s.failedJobs > 0 && (
                  <span className="job-status failed">⚠ {s.failedJobs} failed</span>
                )}
              </div>
            </div>
          )}

          {/* Recent Activity */}
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-3)' }}>
              <h3 style={{ fontSize: 'var(--font-size-md)', fontWeight: 600 }}>Recent Activity</h3>
              <button className="btn btn-ghost btn-sm" onClick={() => setPage('history')}>View History →</button>
            </div>
            {s.recentActivity.length === 0 ? (
              <p style={{ color: 'var(--color-text-tertiary)', fontSize: 'var(--font-size-sm)' }}>
                No recent activity. Start by indexing a folder.
              </p>
            ) : (
              <div className="file-list">
                {s.recentActivity.map((activity) => (
                  <div key={activity.id} className="file-list-item" style={{ gridTemplateColumns: '1fr auto auto' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                      <span>{activity.description}</span>
                    </div>
                    <span className={`job-status ${activity.status}`}>{activity.status}</span>
                    <span style={{ color: 'var(--color-text-tertiary)', fontSize: 'var(--font-size-xs)' }}>
                      {new Date(activity.timestamp).toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};
