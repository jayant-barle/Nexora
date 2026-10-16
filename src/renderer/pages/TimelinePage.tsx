// ============================================================================
// AI File Manager — Timeline Page
// ============================================================================

import React, { useState, useEffect } from 'react';
import { api } from '../services/api';
import type { FileRecord } from '@shared/types';

export const TimelinePage: React.FC = () => {
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewBy, setViewBy] = useState<'year' | 'month' | 'day'>('month');

  useEffect(() => {
    loadTimeline();
  }, []);

  async function loadTimeline() {
    setLoading(true);
    try {
      const result = await api().search.query({ sortBy: 'capture_time', sortOrder: 'desc', limit: 200 });
      setFiles(result.files);
    } catch (err) {
      console.error('Timeline load error:', err);
    } finally {
      setLoading(false);
    }
  }

  // Group files by date
  const groups = files.reduce<Record<string, FileRecord[]>>((acc, file) => {
    const dateStr = file.capture_time || file.file_created_at || file.created_at;
    const date = new Date(dateStr);
    let key: string;
    if (viewBy === 'year') key = `${date.getFullYear()}`;
    else if (viewBy === 'month') key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    else key = date.toISOString().split('T')[0];
    if (!acc[key]) acc[key] = [];
    acc[key].push(file);
    return acc;
  }, {});

  function formatGroupLabel(key: string): string {
    if (viewBy === 'year') return key;
    if (viewBy === 'month') {
      const [y, m] = key.split('-');
      const date = new Date(parseInt(y), parseInt(m) - 1);
      return date.toLocaleDateString(undefined, { year: 'numeric', month: 'long' });
    }
    return new Date(key).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  }

  return (
    <div className="page-content">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-6)' }}>
        <div>
          <h2 style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 700, marginBottom: 'var(--space-1)' }}>Timeline</h2>
          <p style={{ color: 'var(--color-text-secondary)' }}>Browse your media chronologically</p>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
          {(['year', 'month', 'day'] as const).map(v => (
            <button
              key={v}
              className={`btn btn-sm ${viewBy === v ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setViewBy(v)}
            >
              {v.charAt(0).toUpperCase() + v.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="empty-state">
          <div className="empty-icon animate-pulse">📅</div>
          <div className="empty-title">Loading timeline...</div>
        </div>
      ) : files.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">📅</div>
          <div className="empty-title">No media in timeline</div>
          <div className="empty-description">
            Index folders containing photos and videos to see them organized by date.
            The timeline uses capture time from EXIF data when available.
          </div>
        </div>
      ) : (
        (Object.entries(groups) as [string, FileRecord[]][]).map(([key, groupFiles]) => (
          <div key={key} className="timeline-group animate-slideUp">
            <div className="timeline-date">
              📅 {formatGroupLabel(key)}
              <span className="timeline-count">({groupFiles.length} files)</span>
            </div>
            <div className="file-grid">
              {groupFiles.map(file => (
                <div key={file.id} className="file-card" title={file.filename}>
                  <div className="file-icon">
                    {file.mime_type?.startsWith('image/') ? '🖼' : file.mime_type?.startsWith('video/') ? '🎬' : '📄'}
                  </div>
                  <div className="file-name">{file.filename}</div>
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
};
