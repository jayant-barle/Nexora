// ============================================================================
// Nexora — Main Application Shell
// Topbar, Sidebar navigation, view switcher, and global modals
// ============================================================================

import React, { useState, useEffect } from 'react';
import { useNavigationStore, useJobsStore } from './store';
import { api } from './services/api';

// Components & Pages
import { Sidebar } from './components/Sidebar';
import { DashboardPage } from './pages/DashboardPage';
import { ExplorerPage } from './pages/ExplorerPage';
import { PeoplePage } from './pages/PeoplePage';
import { SearchPage } from './pages/SearchPage';
import { TimelinePage } from './pages/TimelinePage';
import { EventsPage } from './pages/EventsPage';
import { DuplicatesPage } from './pages/DuplicatesPage';
import { StoragePage } from './pages/StoragePage';
import { ActivityPage } from './pages/ActivityPage';
import { HistoryPage } from './pages/HistoryPage';
import { WatchedFoldersPage } from './pages/WatchedFoldersPage';
import { SettingsPage } from './pages/SettingsPage';

export const App: React.FC = () => {
  const { currentPage, setPage } = useNavigationStore();
  const { jobs, fetchJobs } = useJobsStore();
  const [quickSearch, setQuickSearch] = useState('');
  const [scanModalOpen, setScanModalOpen] = useState(false);
  const [selectedScanFolder, setSelectedScanFolder] = useState<string | null>(null);
  const [isQueueingScan, setIsQueueingScan] = useState(false);

  // Monitor jobs in background
  useEffect(() => {
    fetchJobs();
    const interval = setInterval(() => {
      fetchJobs('running');
    }, 4000);
    return () => clearInterval(interval);
  }, [fetchJobs]);

  const activeJobs = jobs.filter(j => j.status === 'running');

  // Handle Quick Search submission
  const handleQuickSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (quickSearch.trim()) {
      setPage('search');
    }
  };

  // Open native folder picker for indexing
  const handleBrowseFolderForScan = async () => {
    try {
      const folder = await api().dialog.openFolder();
      if (folder) {
        setSelectedScanFolder(folder);
      }
    } catch (err) {
      console.error('Error selecting folder:', err);
    }
  };

  // Queue indexing scan
  const handleExecuteScan = async () => {
    if (!selectedScanFolder) return;
    setIsQueueingScan(true);
    try {
      await api().jobs.create('folder_scan', selectedScanFolder);
      setScanModalOpen(false);
      setSelectedScanFolder(null);
      setPage('activity');
    } catch (err) {
      console.error('Failed to queue scan:', err);
      alert('Failed to start folder scan: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setIsQueueingScan(false);
    }
  };

  // Render current active page
  const renderPage = () => {
    switch (currentPage) {
      case 'dashboard':
        return <DashboardPage />;
      case 'explorer':
        return <ExplorerPage />;
      case 'people':
        return <PeoplePage />;
      case 'search':
        return <SearchPage />;
      case 'timeline':
        return <TimelinePage />;
      case 'events':
        return <EventsPage />;
      case 'duplicates':
        return <DuplicatesPage />;
      case 'storage':
        return <StoragePage />;
      case 'activity':
        return <ActivityPage />;
      case 'history':
        return <HistoryPage />;
      case 'watched':
        return <WatchedFoldersPage />;
      case 'settings':
        return <SettingsPage />;
      default:
        return <DashboardPage />;
    }
  };

  return (
    <div className="app-layout">
      {/* Sidebar */}
      <Sidebar />

      {/* Main Window Container */}
      <div className="main-content">
        {/* Top Header */}
        <header className="main-header">
          {/* Breadcrumb / Section Label */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
            <span style={{ fontSize: 'var(--font-size-sm)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--color-accent)' }}>
              Nexora
            </span>
            <span style={{ color: 'var(--color-border)' }}>/</span>
            <h1 style={{ fontSize: 'var(--font-size-md)', fontWeight: 600, color: 'var(--color-text-primary)', textTransform: 'capitalize' }}>
              {currentPage.replace(/-/g, ' ')}
            </h1>
          </div>

          {/* Quick Search & Actions */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
            {/* Quick Search Bar */}
            <form onSubmit={handleQuickSearchSubmit} style={{ position: 'relative' }}>
              <input
                type="text"
                placeholder="Search files, people, tags... (Enter)"
                value={quickSearch}
                onChange={e => setQuickSearch(e.target.value)}
                style={{
                  width: '280px',
                  paddingLeft: 'var(--space-7)',
                  fontSize: 'var(--font-size-xs)',
                  height: '32px',
                  borderRadius: 'var(--radius-full)',
                }}
              />
              <span style={{ position: 'absolute', left: '10px', top: '7px', fontSize: '13px', color: 'var(--color-text-tertiary)', pointerEvents: 'none' }}>
                🔍
              </span>
            </form>

            {/* Scan Folder Button */}
            <button
              className="btn btn-sm btn-secondary"
              onClick={() => setScanModalOpen(true)}
              style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}
            >
              <span>📁</span>
              <span>Index Folder</span>
            </button>

            {/* Active Jobs Pill */}
            {activeJobs.length > 0 ? (
              <button
                className="btn btn-sm"
                onClick={() => setPage('activity')}
                style={{
                  background: 'var(--color-accent-dim)',
                  color: 'var(--color-accent)',
                  border: '1px solid var(--color-accent)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-2)',
                }}
              >
                <span className="animate-pulse">⚡</span>
                <span>{activeJobs.length} Processing</span>
              </button>
            ) : (
              <button
                className="btn btn-sm btn-ghost"
                onClick={() => setPage('activity')}
                title="Activity Monitor"
              >
                ⚡ Idle
              </button>
            )}

            {/* Quick Settings Shortcut */}
            <button
              className="btn btn-sm btn-ghost"
              onClick={() => setPage('settings')}
              title="Application Settings"
            >
              ⚙
            </button>
          </div>
        </header>

        {/* Viewport for Active Page */}
        <main style={{ flex: 1, overflow: 'auto', position: 'relative' }}>
          {renderPage()}
        </main>
      </div>

      {/* Index Folder Modal */}
      {scanModalOpen && (
        <div className="modal-overlay" onClick={() => setScanModalOpen(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ width: '480px' }}>
            <div className="modal-header">
              <h3 className="modal-title">Index Directory for AI Analysis</h3>
              <button className="btn btn-ghost" onClick={() => setScanModalOpen(false)}>✕</button>
            </div>

            <div className="modal-body">
              <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', marginBottom: 'var(--space-4)' }}>
                Select a local Windows directory to scan. All media will be registered into the local SQLite database, generating EXIF metadata, smart thumbnails, and face embeddings.
              </p>

              <div style={{ marginBottom: 'var(--space-4)' }}>
                <label style={{ display: 'block', fontSize: 'var(--font-size-xs)', fontWeight: 600, marginBottom: 'var(--space-1)' }}>
                  Folder Path
                </label>
                <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                  <input
                    type="text"
                    value={selectedScanFolder || ''}
                    placeholder="Click Browse to select folder..."
                    readOnly
                    style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-xs)' }}
                  />
                  <button className="btn btn-secondary btn-sm" onClick={handleBrowseFolderForScan}>
                    Browse...
                  </button>
                </div>
              </div>

              <div style={{ background: 'var(--color-bg-secondary)', padding: 'var(--space-3)', borderRadius: 'var(--radius-md)', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)' }}>
                <div style={{ fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: '4px' }}>Security & Non-Destructive Guarantee:</div>
                • Source files are NEVER modified or moved during indexing.<br />
                • All AI inferences run strictly local on this PC.<br />
                • Safe NTFS read-only attributes are respected.
              </div>
            </div>

            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setScanModalOpen(false)} disabled={isQueueingScan}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={handleExecuteScan}
                disabled={!selectedScanFolder || isQueueingScan}
              >
                {isQueueingScan ? 'Queueing...' : 'Start Indexing'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
