// ============================================================================
// Nexora — Main Application Shell
// Topbar, Sidebar navigation, view switcher, and global modals
// ============================================================================

import React, { useState, useEffect, useRef } from 'react';
import { useNavigationStore, useJobsStore, useExplorerStore, toast } from './store';
import { api } from './services/api';

// Components & Pages
import { Sidebar } from './components/Sidebar';
import { ToastContainer } from './components/Toast';
import { DashboardPage } from './pages/DashboardPage';
import { ExplorerPage } from './pages/ExplorerPage';
import { PeoplePage } from './pages/PeoplePage';
import { SearchPage } from './pages/SearchPage';
import { TimelinePage } from './pages/TimelinePage';
import { EventsPage } from './pages/EventsPage';
import { DuplicatesPage } from './pages/DuplicatesPage';
import { OrganizePage } from './pages/OrganizePage';
import { StoragePage } from './pages/StoragePage';
import { ActivityPage } from './pages/ActivityPage';
import { HistoryPage } from './pages/HistoryPage';
import { WatchedFoldersPage } from './pages/WatchedFoldersPage';
import { SettingsPage } from './pages/SettingsPage';

export const App: React.FC = () => {
  const { currentPage, setPage } = useNavigationStore();
  const { jobs, queueStats, fetchJobs, fetchQueueStats, initListeners } = useJobsStore();
  const { tabs, activeTabId, setActiveTab, closeTab, addTab } = useExplorerStore();
  const [quickSearch, setQuickSearch] = useState('');
  const [scanModalOpen, setScanModalOpen] = useState(false);
  const [selectedScanFolder, setSelectedScanFolder] = useState<string | null>(null);
  const [isQueueingScan, setIsQueueingScan] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Global desktop keyboard shortcuts & custom events
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+T: new tab
      if ((e.ctrlKey || e.metaKey) && e.key === 't') {
        e.preventDefault();
        addTab();
      }
      // Ctrl+W: close active tab
      if ((e.ctrlKey || e.metaKey) && e.key === 'w') {
        e.preventDefault();
        if (tabs.length > 1) {
          closeTab(activeTabId);
        }
      }
      // Ctrl+F / Ctrl+K: focus search
      if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'k')) {
        e.preventDefault();
        setPage('search');
        searchInputRef.current?.focus();
      }
      // Ctrl+I: open folder indexing dialog
      if ((e.ctrlKey || e.metaKey) && e.key === 'i') {
        e.preventDefault();
        setScanModalOpen(true);
      }
      // Ctrl+,: settings
      if ((e.ctrlKey || e.metaKey) && e.key === ',') {
        e.preventDefault();
        setPage('settings');
      }
      // Escape: close open modal
      if (e.key === 'Escape') {
        setScanModalOpen(false);
      }
    };

    const handleOpenScan = () => setScanModalOpen(true);

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('open-scan-modal', handleOpenScan);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('open-scan-modal', handleOpenScan);
    };
  }, [setPage, addTab, closeTab, tabs.length, activeTabId]);

  // Monitor jobs in background with real-time event listeners and stats
  useEffect(() => {
    fetchJobs();
    fetchQueueStats();
    const cleanup = initListeners();
    const interval = setInterval(() => {
      fetchQueueStats();
    }, 4000);
    return () => {
      cleanup();
      clearInterval(interval);
    };
  }, [fetchJobs, fetchQueueStats, initListeners]);

  const activeJobsCount = queueStats ? queueStats.activeJobs : jobs.filter(j => j.status === 'running').length;

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
      const folderName = selectedScanFolder.split(/[\\/]/).pop() || selectedScanFolder;
      // 1. Authorize root in database
      await api().roots.add(selectedScanFolder, folderName, 'indexed');
      // 2. Dispatch persistent folder scan job (runs discovery, metadata extraction, hashing, deduplication, and AI)
      await api().jobs.create('folder_scan', selectedScanFolder, undefined, { extractAi: true, generateThumbnails: true });
      toast.success(
        `Authorized "${folderName}". Scan, AI metadata indexing & duplicate detection started.`,
        'Workflow Initiated'
      );
      setScanModalOpen(false);
      setSelectedScanFolder(null);
      setPage('activity');
    } catch (err) {
      console.error('Failed to queue scan:', err);
      toast.error(err instanceof Error ? err.message : String(err), 'Failed to start scan');
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
      case 'organize':
        return <OrganizePage />;
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
        {/* Windows 11 Tab Strip & Top Header */}
        <header className="main-header win11-tab-header" style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 var(--space-3)',
          height: '42px',
          background: 'var(--color-bg-secondary)',
          borderBottom: '1px solid var(--color-border)',
          gap: 'var(--space-2)',
          userSelect: 'none',
        }}>
          {/* Windows 11 Tabs List */}
          <div className="win11-tab-strip" style={{
            display: 'flex',
            alignItems: 'center',
            gap: '2px',
            flex: 1,
            minWidth: 0,
            overflowX: 'auto',
            height: '100%',
          }}>
            {tabs.map((tab) => {
              const isActive = tab.id === activeTabId;
              return (
                <div
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`win11-tab ${isActive ? 'active' : ''}`}
                  title={tab.path || tab.title}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '0 12px',
                    height: '34px',
                    borderRadius: 'var(--radius-sm) var(--radius-sm) 0 0',
                    background: isActive ? 'var(--color-bg-primary)' : 'transparent',
                    border: isActive ? '1px solid var(--color-border)' : '1px solid transparent',
                    borderBottom: isActive ? '1px solid var(--color-bg-primary)' : '1px solid transparent',
                    color: isActive ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
                    fontSize: 'var(--font-size-xs)',
                    fontWeight: isActive ? 600 : 400,
                    cursor: 'pointer',
                    maxWidth: '180px',
                    minWidth: '110px',
                    position: 'relative',
                    transition: 'background 0.15s, color 0.15s',
                  }}
                >
                  {/* Subtle active neon-lime indicator */}
                  {isActive && (
                    <div style={{
                      position: 'absolute',
                      top: 0,
                      left: '8px',
                      right: '8px',
                      height: '2px',
                      background: 'var(--color-accent)',
                      borderRadius: '1px',
                    }} />
                  )}
                  <span style={{ fontSize: '12px', flexShrink: 0 }}>{tab.icon || '📁'}</span>
                  <span style={{
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    flex: 1,
                  }}>
                    {tab.title}
                  </span>
                  {tabs.length > 1 && (
                    <button
                      className="tab-close-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        closeTab(tab.id);
                      }}
                      title="Close tab (Ctrl+W)"
                      style={{
                        padding: '1px 4px',
                        borderRadius: '3px',
                        fontSize: '10px',
                        color: 'var(--color-text-tertiary)',
                        lineHeight: 1,
                      }}
                    >
                      ✕
                    </button>
                  )}
                </div>
              );
            })}

            {/* Add Tab Button */}
            <button
              onClick={() => addTab()}
              className="btn btn-ghost btn-sm"
              title="New tab (Ctrl+T)"
              style={{
                width: '28px',
                height: '28px',
                padding: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--color-text-tertiary)',
              }}
            >
              ➕
            </button>
          </div>

          {/* Quick Actions (Search, Index Folder, Processing Pill, Settings) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexShrink: 0 }}>
            {/* Quick Search */}
            <form onSubmit={handleQuickSearchSubmit} style={{ position: 'relative' }}>
              <input
                ref={searchInputRef}
                type="text"
                placeholder="Search Nexora... (Ctrl+F)"
                value={quickSearch}
                onChange={e => setQuickSearch(e.target.value)}
                style={{
                  width: '210px',
                  paddingLeft: 'var(--space-6)',
                  fontSize: 'var(--font-size-xs)',
                  height: '28px',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--color-bg-primary)',
                  border: '1px solid var(--color-border)',
                }}
              />
              <span style={{ position: 'absolute', left: '8px', top: '6px', fontSize: '11px', color: 'var(--color-text-tertiary)', pointerEvents: 'none' }}>
                🔍
              </span>
            </form>

            {/* Index Folder Button */}
            <button
              className="btn btn-sm btn-secondary"
              onClick={() => setScanModalOpen(true)}
              style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', height: '28px', padding: '0 8px', fontSize: 'var(--font-size-xs)' }}
              title="Index / Authorize Folder (Ctrl+I)"
            >
              <span>📁</span>
              <span>Index Folder</span>
            </button>

            {/* Active Jobs Pill */}
            {activeJobsCount > 0 ? (
              <button
                className="btn btn-sm"
                onClick={() => setPage('activity')}
                style={{
                  background: 'var(--color-accent-dim)',
                  color: 'var(--color-accent)',
                  border: '1px solid var(--color-accent)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  height: '28px',
                  padding: '0 8px',
                  fontSize: 'var(--font-size-xs)',
                }}
              >
                <span className="animate-pulse">⚡</span>
                <span>{activeJobsCount} Processing</span>
              </button>
            ) : (
              <button
                className="btn btn-sm btn-ghost"
                onClick={() => setPage('activity')}
                title="Activity Monitor"
                style={{ height: '28px', padding: '0 6px', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)' }}
              >
                ⚡ Idle
              </button>
            )}

            {/* Quick Settings Shortcut */}
            <button
              className="btn btn-sm btn-ghost"
              onClick={() => setPage('settings')}
              title="Settings (Ctrl+,)"
              style={{ width: '28px', height: '28px', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
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
      {/* In-app Toast Notifications */}
      <ToastContainer />
    </div>
  );
};
