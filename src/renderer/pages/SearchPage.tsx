// ============================================================================
// AI File Manager — Search Page
// ============================================================================

import React, { useState, useCallback } from 'react';
import { api } from '../services/api';
import type { FileRecord, SearchQuery } from '@shared/types';

function formatSize(bytes: number): string {
  if (bytes === 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

export const SearchPage: React.FC = () => {
  const [searchText, setSearchText] = useState('');
  const [results, setResults] = useState<FileRecord[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [executionTime, setExecutionTime] = useState(0);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  // Filters
  const [filterExt, setFilterExt] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [filterSizeMin, setFilterSizeMin] = useState('');
  const [filterSizeMax, setFilterSizeMax] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  const handleSearch = useCallback(async () => {
    if (!searchText.trim() && !filterExt && !filterDateFrom) return;

    setLoading(true);
    setSearched(true);
    try {
      const query: SearchQuery = {
        text: searchText || undefined,
        extension: filterExt ? filterExt.split(',').map(e => e.trim()) : undefined,
        dateFrom: filterDateFrom || undefined,
        dateTo: filterDateTo || undefined,
        sizeMin: filterSizeMin ? parseInt(filterSizeMin) * 1024 * 1024 : undefined,
        sizeMax: filterSizeMax ? parseInt(filterSizeMax) * 1024 * 1024 : undefined,
        limit: 100,
      };
      const result = await api().search.query(query);
      setResults(result.files);
      setTotalCount(result.totalCount);
      setExecutionTime(result.executionTimeMs);
    } catch (err) {
      console.error('Search error:', err);
    } finally {
      setLoading(false);
    }
  }, [searchText, filterExt, filterDateFrom, filterDateTo, filterSizeMin, filterSizeMax]);

  return (
    <div className="page-content">
      <div style={{ marginBottom: 'var(--space-6)' }}>
        <h2 style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 700, marginBottom: 'var(--space-1)' }}>Smart Search</h2>
        <p style={{ color: 'var(--color-text-secondary)' }}>Search across your indexed media library</p>
      </div>

      {/* Search Bar */}
      <div style={{ marginBottom: 'var(--space-4)' }}>
        <div className="search-bar" style={{ padding: 'var(--space-2) var(--space-4)' }}>
          <span className="search-icon">🔍</span>
          <input
            type="text"
            placeholder="Search files, people, tags, OCR text..."
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSearch()}
            style={{ fontSize: 'var(--font-size-md)', padding: 'var(--space-2) 0' }}
          />
          <button className="btn btn-ghost btn-sm" onClick={() => setShowFilters(!showFilters)}>
            ⚙ Filters
          </button>
          <button className="btn btn-primary btn-sm" onClick={handleSearch}>Search</button>
        </div>

        {/* Filters panel */}
        {showFilters && (
          <div className="card" style={{ marginTop: 'var(--space-2)', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 'var(--space-3)', padding: 'var(--space-4)' }}>
            <div>
              <label style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', marginBottom: 'var(--space-1)', display: 'block' }}>File Extensions</label>
              <input placeholder=".jpg, .png, .mp4" value={filterExt} onChange={e => setFilterExt(e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', marginBottom: 'var(--space-1)', display: 'block' }}>Date From</label>
              <input type="date" value={filterDateFrom} onChange={e => setFilterDateFrom(e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', marginBottom: 'var(--space-1)', display: 'block' }}>Date To</label>
              <input type="date" value={filterDateTo} onChange={e => setFilterDateTo(e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', marginBottom: 'var(--space-1)', display: 'block' }}>Min Size (MB)</label>
              <input type="number" placeholder="0" value={filterSizeMin} onChange={e => setFilterSizeMin(e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', marginBottom: 'var(--space-1)', display: 'block' }}>Max Size (MB)</label>
              <input type="number" placeholder="Any" value={filterSizeMax} onChange={e => setFilterSizeMax(e.target.value)} />
            </div>
          </div>
        )}
      </div>

      {/* Results */}
      {loading ? (
        <div className="empty-state">
          <div className="empty-icon animate-pulse">🔍</div>
          <div className="empty-title">Searching...</div>
        </div>
      ) : !searched ? (
        <div className="empty-state">
          <div className="empty-icon">🔍</div>
          <div className="empty-title">Start Searching</div>
          <div className="empty-description">
            Enter a search term or use filters to find files across your indexed library.
            Search supports filenames, paths, extensions, date ranges, and file sizes.
          </div>
        </div>
      ) : results.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">📭</div>
          <div className="empty-title">No Results Found</div>
          <div className="empty-description">
            Try different search terms or adjust your filters. Only indexed files are searchable.
          </div>
        </div>
      ) : (
        <div>
          <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-tertiary)', marginBottom: 'var(--space-3)' }}>
            {totalCount} results found in {executionTime}ms
          </div>
          <div className="file-list">
            <div className="file-list-header">
              <span>File</span>
              <span>Size</span>
              <span>Modified</span>
              <span>Type</span>
            </div>
            {results.map(file => (
              <div key={file.id} className="file-list-item" onClick={() => api().fs.revealInExplorer(file.relative_path)}>
                <div className="file-list-name">
                  <span>📄</span>
                  <span title={file.relative_path}>{file.filename}</span>
                </div>
                <span style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)' }}>
                  {formatSize(file.size_bytes)}
                </span>
                <span style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)' }}>
                  {file.file_modified_at ? new Date(file.file_modified_at).toLocaleDateString() : '—'}
                </span>
                <span style={{ color: 'var(--color-text-tertiary)', fontSize: 'var(--font-size-sm)' }}>
                  {file.extension}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
