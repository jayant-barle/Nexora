// ============================================================================
// Nexora — Windows 11 File Explorer Navigation Pane
// Quick Access, This PC (Drives), Registered Folders, and Nexora Intelligence
// ============================================================================

import React, { useEffect, useState } from 'react';
import type { NavigationPage } from '../../shared/types';
import { useNavigationStore, useExplorerStore, useJobsStore } from '../store';

export const Sidebar: React.FC = () => {
  const { currentPage, sidebarCollapsed, setPage, toggleSidebar } = useNavigationStore();
  const { drives, roots, userPaths, currentPath, navigateTo, loadDrives, loadRoots, loadUserPaths } = useExplorerStore();
  const { jobs, queueStats } = useJobsStore();

  const [expandedSections, setExpandedSections] = useState({
    quickAccess: true,
    thisPc: true,
    registeredRoots: true,
    nexoraAi: true,
  });

  useEffect(() => {
    loadDrives();
    loadRoots();
    loadUserPaths();
  }, [loadDrives, loadRoots, loadUserPaths]);

  const toggleSection = (section: keyof typeof expandedSections) => {
    setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  const handleNavigateToFolder = (pathStr?: string) => {
    if (!pathStr) return;
    setPage('explorer');
    navigateTo(pathStr);
  };

  const activeJobsCount = queueStats ? queueStats.activeJobs : jobs.filter((j) => j.status === 'running').length;

  return (
    <aside className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''}`} aria-label="Navigation Pane">
      {/* Sidebar Brand Header */}
      <div className="sidebar-header" style={{ padding: 'var(--space-3) var(--space-4)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--color-border-subtle)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <div className="sidebar-logo" style={{
            width: '28px', height: '28px', borderRadius: 'var(--radius-sm)',
            background: 'linear-gradient(135deg, var(--color-accent) 0%, #70a800 100%)',
            color: '#000', fontWeight: 800, fontSize: '14px', display: 'flex',
            alignItems: 'center', justifyContent: 'center'
          }}>
            N
          </div>
          {!sidebarCollapsed && (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: 'var(--font-size-sm)', fontWeight: 700, letterSpacing: '0.04em', color: 'var(--color-text-primary)' }}>Nexora</span>
              <span style={{ fontSize: '10px', color: 'var(--color-text-tertiary)', letterSpacing: '0.04em' }}>Explorer Edition</span>
            </div>
          )}
        </div>
        <button
          onClick={toggleSidebar}
          className="btn btn-ghost btn-sm"
          title={sidebarCollapsed ? 'Expand navigation pane' : 'Collapse navigation pane'}
          style={{ padding: '2px 6px', fontSize: '12px', color: 'var(--color-text-tertiary)' }}
        >
          {sidebarCollapsed ? '›' : '‹'}
        </button>
      </div>

      <nav className="sidebar-nav" style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-2) 0' }}>
        {/* ─── 1. Quick Access / Pinned Folders ───────────────────────────────── */}
        <div className="nav-tree-section">
          {!sidebarCollapsed && (
            <div
              className="nav-section-header"
              onClick={() => toggleSection('quickAccess')}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', padding: '6px 14px', fontSize: '11px', fontWeight: 600, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}
            >
              <span>Quick Access</span>
              <span style={{ fontSize: '10px', transition: 'transform 0.2s', transform: expandedSections.quickAccess ? 'rotate(90deg)' : 'none' }}>›</span>
            </div>
          )}

          {(expandedSections.quickAccess || sidebarCollapsed) && (
            <div className="nav-section-items">
              {/* Home / Dashboard */}
              <div
                className={`nav-item ${currentPage === 'dashboard' ? 'active' : ''}`}
                onClick={() => setPage('dashboard')}
                title="Home"
              >
                <span className="nav-icon">🏠</span>
                {!sidebarCollapsed && <span className="nav-label">Home</span>}
              </div>

              {/* Desktop */}
              {userPaths.desktop && (
                <div
                  className={`nav-item ${currentPage === 'explorer' && currentPath.toLowerCase() === userPaths.desktop.toLowerCase() ? 'active' : ''}`}
                  onClick={() => handleNavigateToFolder(userPaths.desktop)}
                  title="Desktop"
                >
                  <span className="nav-icon">🖥</span>
                  {!sidebarCollapsed && <span className="nav-label">Desktop</span>}
                </div>
              )}

              {/* Downloads */}
              {userPaths.downloads && (
                <div
                  className={`nav-item ${currentPage === 'explorer' && currentPath.toLowerCase() === userPaths.downloads.toLowerCase() ? 'active' : ''}`}
                  onClick={() => handleNavigateToFolder(userPaths.downloads)}
                  title="Downloads"
                >
                  <span className="nav-icon">📥</span>
                  {!sidebarCollapsed && <span className="nav-label">Downloads</span>}
                </div>
              )}

              {/* Documents */}
              {userPaths.documents && (
                <div
                  className={`nav-item ${currentPage === 'explorer' && currentPath.toLowerCase() === userPaths.documents.toLowerCase() ? 'active' : ''}`}
                  onClick={() => handleNavigateToFolder(userPaths.documents)}
                  title="Documents"
                >
                  <span className="nav-icon">📄</span>
                  {!sidebarCollapsed && <span className="nav-label">Documents</span>}
                </div>
              )}

              {/* Pictures */}
              {userPaths.pictures && (
                <div
                  className={`nav-item ${currentPage === 'explorer' && currentPath.toLowerCase() === userPaths.pictures.toLowerCase() ? 'active' : ''}`}
                  onClick={() => handleNavigateToFolder(userPaths.pictures)}
                  title="Pictures"
                >
                  <span className="nav-icon">🖼</span>
                  {!sidebarCollapsed && <span className="nav-label">Pictures</span>}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ─── 2. This PC (Drives) ────────────────────────────────────────────── */}
        <div className="nav-tree-section" style={{ marginTop: 'var(--space-2)' }}>
          {!sidebarCollapsed && (
            <div
              className="nav-section-header"
              onClick={() => toggleSection('thisPc')}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', padding: '6px 14px', fontSize: '11px', fontWeight: 600, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}
            >
              <span>This PC</span>
              <span style={{ fontSize: '10px', transition: 'transform 0.2s', transform: expandedSections.thisPc ? 'rotate(90deg)' : 'none' }}>›</span>
            </div>
          )}

          {(expandedSections.thisPc || sidebarCollapsed) && (
            <div className="nav-section-items">
              {/* Root This PC overview */}
              <div
                className={`nav-item ${currentPage === 'explorer' && !currentPath ? 'active' : ''}`}
                onClick={() => {
                  setPage('explorer');
                  useExplorerStore.getState().navigateTo('');
                }}
                title="This PC"
              >
                <span className="nav-icon">💻</span>
                {!sidebarCollapsed && <span className="nav-label">This PC Overview</span>}
              </div>

              {/* Individual Drives */}
              {drives.map((drive) => {
                const isSelected = currentPage === 'explorer' && currentPath.toUpperCase().startsWith(drive.letter.toUpperCase());
                const usedPct = drive.totalSize > 0 ? (drive.usedSpace / drive.totalSize) * 100 : 0;
                return (
                  <div
                    key={drive.letter}
                    className={`nav-item ${isSelected ? 'active' : ''}`}
                    onClick={() => handleNavigateToFolder(drive.letter + '\\')}
                    title={`${drive.label || drive.letter} (${drive.letter})`}
                    style={{ position: 'relative' }}
                  >
                    <span className="nav-icon">💿</span>
                    {!sidebarCollapsed && (
                      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span className="nav-label" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {drive.label ? `${drive.label} (${drive.letter})` : drive.letter}
                          </span>
                        </div>
                        {drive.totalSize > 0 && (
                          <div style={{ width: '100%', height: '3px', background: 'rgba(255,255,255,0.1)', borderRadius: '2px', marginTop: '3px', overflow: 'hidden' }}>
                            <div
                              style={{
                                width: `${usedPct}%`,
                                height: '100%',
                                background: usedPct > 90 ? 'var(--color-error)' : 'var(--color-accent)',
                              }}
                            />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ─── 3. Registered Folders ────────────────────────────────────────── */}
        <div className="nav-tree-section" style={{ marginTop: 'var(--space-2)' }}>
          {!sidebarCollapsed && (
            <div
              className="nav-section-header"
              onClick={() => toggleSection('registeredRoots')}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', padding: '6px 14px', fontSize: '11px', fontWeight: 600, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}
            >
              <span>Registered Folders</span>
              <span style={{ fontSize: '10px', transition: 'transform 0.2s', transform: expandedSections.registeredRoots ? 'rotate(90deg)' : 'none' }}>›</span>
            </div>
          )}

          {(expandedSections.registeredRoots || sidebarCollapsed) && (
            <div className="nav-section-items">
              {roots.map((root) => {
                const isSelected = currentPage === 'explorer' && currentPath.toLowerCase().startsWith(root.path.toLowerCase());
                return (
                  <div
                    key={root.id}
                    className={`nav-item ${isSelected ? 'active' : ''}`}
                    onClick={() => handleNavigateToFolder(root.path)}
                    title={root.path}
                  >
                    <span className="nav-icon">📁</span>
                    {!sidebarCollapsed && (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', minWidth: 0 }}>
                        <span className="nav-label" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {root.label}
                        </span>
                        <span style={{ fontSize: '9px', padding: '1px 4px', borderRadius: '3px', background: 'var(--color-bg-tertiary)', color: 'var(--color-text-tertiary)' }}>
                          {root.type}
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Add Folder button */}
              <div
                className="nav-item"
                onClick={() => window.dispatchEvent(new CustomEvent('open-scan-modal'))}
                title="Index New Folder"
                style={{ color: 'var(--color-accent)', opacity: 0.9 }}
              >
                <span className="nav-icon">➕</span>
                {!sidebarCollapsed && <span className="nav-label" style={{ fontSize: 'var(--font-size-xs)' }}>Authorize Folder...</span>}
              </div>
            </div>
          )}
        </div>

        {/* ─── 4. Nexora Intelligence (Distinct AI section) ─────────────────── */}
        <div className="nav-tree-section" style={{
          marginTop: 'var(--space-3)',
          paddingTop: 'var(--space-2)',
          borderTop: '1px solid rgba(180, 255, 50, 0.15)',
          background: 'rgba(180, 255, 50, 0.02)',
        }}>
          {!sidebarCollapsed && (
            <div
              className="nav-section-header"
              onClick={() => toggleSection('nexoraAi')}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                cursor: 'pointer', padding: '6px 14px', fontSize: '11px', fontWeight: 700,
                color: 'var(--color-accent)', textTransform: 'uppercase', letterSpacing: '0.08em'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '12px' }}>⚡</span>
                <span>Nexora AI</span>
              </div>
              <span style={{ fontSize: '10px', transition: 'transform 0.2s', transform: expandedSections.nexoraAi ? 'rotate(90deg)' : 'none' }}>›</span>
            </div>
          )}

          {(expandedSections.nexoraAi || sidebarCollapsed) && (
            <div className="nav-section-items">
              <div
                className={`nav-item ${currentPage === 'people' ? 'active' : ''}`}
                onClick={() => setPage('people')}
                title="People & Faces"
              >
                <span className="nav-icon">👤</span>
                {!sidebarCollapsed && <span className="nav-label">People</span>}
              </div>

              <div
                className={`nav-item ${currentPage === 'duplicates' ? 'active' : ''}`}
                onClick={() => setPage('duplicates')}
                title="Duplicates"
              >
                <span className="nav-icon">🔄</span>
                {!sidebarCollapsed && <span className="nav-label">Duplicates</span>}
              </div>

              <div
                className={`nav-item ${currentPage === 'organize' ? 'active' : ''}`}
                onClick={() => setPage('organize')}
                title="Organize & Sort"
              >
                <span className="nav-icon">🪄</span>
                {!sidebarCollapsed && <span className="nav-label">Organize & Sort</span>}
              </div>

              <div
                className={`nav-item ${currentPage === 'timeline' ? 'active' : ''}`}
                onClick={() => setPage('timeline')}
                title="Timeline"
              >
                <span className="nav-icon">📅</span>
                {!sidebarCollapsed && <span className="nav-label">Timeline</span>}
              </div>

              <div
                className={`nav-item ${currentPage === 'events' ? 'active' : ''}`}
                onClick={() => setPage('events')}
                title="Events & Places"
              >
                <span className="nav-icon">📍</span>
                {!sidebarCollapsed && <span className="nav-label">Events & Places</span>}
              </div>

              <div
                className={`nav-item ${currentPage === 'watched' ? 'active' : ''}`}
                onClick={() => setPage('watched')}
                title="Watched Folders"
              >
                <span className="nav-icon">👁</span>
                {!sidebarCollapsed && <span className="nav-label">Watched Folders</span>}
              </div>

              <div
                className={`nav-item ${currentPage === 'storage' ? 'active' : ''}`}
                onClick={() => setPage('storage')}
                title="Storage"
              >
                <span className="nav-icon">💾</span>
                {!sidebarCollapsed && <span className="nav-label">Storage</span>}
              </div>

              <div
                className={`nav-item ${currentPage === 'activity' ? 'active' : ''}`}
                onClick={() => setPage('activity')}
                title="Activity Monitor"
              >
                <span className="nav-icon">⚡</span>
                {!sidebarCollapsed && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                    <span className="nav-label">Activity</span>
                    {activeJobsCount > 0 && (
                      <span className="nav-badge" style={{ background: 'var(--color-accent)', color: '#000', fontWeight: 700 }}>
                        {activeJobsCount}
                      </span>
                    )}
                  </div>
                )}
              </div>

              <div
                className={`nav-item ${currentPage === 'history' ? 'active' : ''}`}
                onClick={() => setPage('history')}
                title="Operations History"
              >
                <span className="nav-icon">📜</span>
                {!sidebarCollapsed && <span className="nav-label">History & Undo</span>}
              </div>
            </div>
          )}
        </div>
      </nav>

      {/* Footer / Settings */}
      <div style={{ padding: 'var(--space-2) var(--space-3)', borderTop: '1px solid var(--color-border-subtle)' }}>
        <div
          className={`nav-item ${currentPage === 'settings' ? 'active' : ''}`}
          onClick={() => setPage('settings')}
          title="Settings"
          style={{ margin: 0 }}
        >
          <span className="nav-icon">⚙</span>
          {!sidebarCollapsed && <span className="nav-label">Settings</span>}
        </div>
      </div>
    </aside>
  );
};
