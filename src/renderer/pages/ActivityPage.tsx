// ============================================================================
// AI File Manager — Activity & Background Jobs Page
// Live background worker queue, job management, progress telemetry, and logs
// ============================================================================

import React, { useState, useEffect } from 'react';
import { useJobsStore } from '../store';
import type { JobStatus } from '@shared/types';

export const ActivityPage: React.FC = () => {
  const { jobs, loading, fetchJobs, pauseJob, resumeJob, cancelJob } = useJobsStore();
  const [filter, setFilter] = useState<string>('all');

  useEffect(() => {
    fetchJobs();
    const timer = setInterval(() => fetchJobs(), 3000);
    return () => clearInterval(timer);
  }, [fetchJobs]);

  const filteredJobs = jobs.filter(j => {
    if (filter === 'all') return true;
    return j.status === filter;
  });

  const activeCount = jobs.filter(j => j.status === 'running').length;
  const queuedCount = jobs.filter(j => j.status === 'queued').length;
  const failedCount = jobs.filter(j => j.status === 'failed').length;

  return (
    <div className="page-content animate-fadeIn">
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-6)' }}>
        <div>
          <h2 style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 700, marginBottom: 'var(--space-1)' }}>
            Activity & Background Processing
          </h2>
          <p style={{ color: 'var(--color-text-secondary)' }}>
            Real-time status of metadata indexing, face detection, embeddings, and media organization.
          </p>
        </div>
        <button className="btn btn-secondary" onClick={() => fetchJobs()}>
          ↻ Refresh Queue
        </button>
      </div>

      {/* KPI Ribbon */}
      <div className="stats-grid" style={{ marginBottom: 'var(--space-6)' }}>
        <div className="stat-card">
          <div className="stat-label">Currently Processing</div>
          <div className="stat-value text-accent">{activeCount}</div>
          <div className="stat-subtext">Active worker threads</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Queued Jobs</div>
          <div className="stat-value">{queuedCount}</div>
          <div className="stat-subtext">Awaiting execution</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Completed Jobs</div>
          <div className="stat-value">{jobs.filter(j => j.status === 'completed').length}</div>
          <div className="stat-subtext">Successfully processed</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Failed / Retrying</div>
          <div className={`stat-value ${failedCount > 0 ? 'text-error' : ''}`}>{failedCount}</div>
          <div className="stat-subtext">With logged error stack</div>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="tabs" style={{ marginBottom: 'var(--space-4)' }}>
        <button className={`tab ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>
          All Jobs ({jobs.length})
        </button>
        <button className={`tab ${filter === 'running' ? 'active' : ''}`} onClick={() => setFilter('running')}>
          Active ({activeCount})
        </button>
        <button className={`tab ${filter === 'queued' ? 'active' : ''}`} onClick={() => setFilter('queued')}>
          Queued ({queuedCount})
        </button>
        <button className={`tab ${filter === 'completed' ? 'active' : ''}`} onClick={() => setFilter('completed')}>
          Completed ({jobs.filter(j => j.status === 'completed').length})
        </button>
        <button className={`tab ${filter === 'failed' ? 'active' : ''}`} onClick={() => setFilter('failed')}>
          Failed ({failedCount})
        </button>
      </div>

      {/* Job Items List */}
      {loading && jobs.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon animate-pulse">⚡</div>
          <div className="empty-title">Loading background jobs...</div>
        </div>
      ) : filteredJobs.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">☕</div>
          <div className="empty-title">Queue is idle</div>
          <div className="empty-description">
            There are no {filter !== 'all' ? filter : ''} tasks running right now. When you index folders, detect faces, or organize files, jobs will appear here automatically.
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {filteredJobs.map(job => {
            const progressPct = job.total > 0 ? Math.round((job.progress / job.total) * 100) : 0;

            const statusBadgeClass =
              job.status === 'running'
                ? 'badge-primary'
                : job.status === 'completed'
                ? 'badge-success'
                : job.status === 'failed'
                ? 'badge-error'
                : job.status === 'paused'
                ? 'badge-warning'
                : 'badge-secondary';

            return (
              <div key={job.id} className="card" style={{ padding: 'var(--space-4)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--space-2)' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                      <span className={`badge ${statusBadgeClass}`}>
                        {job.status.toUpperCase()}
                      </span>
                      <span style={{ fontWeight: 600, fontSize: 'var(--font-size-md)' }}>
                        {job.type.replace(/_/g, ' ').toUpperCase()}
                      </span>
                    </div>
                    {job.target_path && (
                      <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)', marginTop: '4px' }}>
                        Target: {job.target_path}
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                    {job.status === 'running' && (
                      <button className="btn btn-sm btn-ghost" onClick={() => pauseJob(job.id)} title="Pause Job">
                        ⏸ Pause
                      </button>
                    )}
                    {job.status === 'paused' && (
                      <button className="btn btn-sm btn-ghost" onClick={() => resumeJob(job.id)} title="Resume Job">
                        ▶ Resume
                      </button>
                    )}
                    {(job.status === 'running' || job.status === 'queued' || job.status === 'paused') && (
                      <button className="btn btn-sm btn-ghost" style={{ color: 'var(--color-error)' }} onClick={() => cancelJob(job.id)} title="Cancel Job">
                        ✕ Cancel
                      </button>
                    )}
                  </div>
                </div>

                {/* Progress bar */}
                {(job.status === 'running' || job.status === 'paused') && (
                  <div style={{ marginTop: 'var(--space-3)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--font-size-xs)', marginBottom: '4px', color: 'var(--color-text-secondary)' }}>
                      <span>{job.progress} / {job.total} files</span>
                      <span>{progressPct}%</span>
                    </div>
                    <div className="progress-bar">
                      <div className="progress-fill" style={{ width: `${progressPct}%` }} />
                    </div>
                  </div>
                )}

                {/* Error message if failed */}
                {job.error_message && (
                  <div style={{ marginTop: 'var(--space-3)', padding: 'var(--space-2) var(--space-3)', background: 'var(--color-error-dim)', border: '1px solid var(--color-error)', borderRadius: 'var(--radius-sm)', color: 'var(--color-error)', fontSize: 'var(--font-size-xs)' }}>
                    Error: {job.error_message}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
