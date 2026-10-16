// ============================================================================
// Nexora — Sidebar Component
// ============================================================================

import React from 'react';
import type { NavigationPage } from '@shared/types';
import { useNavigationStore } from '../store';

interface NavItem {
  id: NavigationPage;
  label: string;
  icon: string;
  section: string;
  badge?: number;
}

const navItems: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: '◈', section: 'Overview' },
  { id: 'explorer', label: 'File Explorer', icon: '📁', section: 'Browse' },
  { id: 'people', label: 'People', icon: '👤', section: 'AI Features' },
  { id: 'search', label: 'Smart Search', icon: '🔍', section: 'AI Features' },
  { id: 'timeline', label: 'Timeline', icon: '📅', section: 'AI Features' },
  { id: 'events', label: 'Events & Places', icon: '📍', section: 'AI Features' },
  { id: 'duplicates', label: 'Duplicates', icon: '🔄', section: 'Tools' },
  { id: 'storage', label: 'Storage', icon: '💾', section: 'Tools' },
  { id: 'activity', label: 'Activity', icon: '⚡', section: 'System' },
  { id: 'history', label: 'History', icon: '🕐', section: 'System' },
  { id: 'watched', label: 'Watched Folders', icon: '👁', section: 'System' },
  { id: 'settings', label: 'Settings', icon: '⚙', section: 'System' },
];

export const Sidebar: React.FC = () => {
  const { currentPage, sidebarCollapsed, setPage, toggleSidebar } = useNavigationStore();

  const sections = Array.from(new Set(navItems.map(i => i.section)));

  return (
    <aside className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}>
      <div className="sidebar-header">
        <div className="sidebar-logo">N</div>
        <div className="sidebar-title-group" style={{ display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
          <span className="sidebar-title" style={{ letterSpacing: '0.04em', fontWeight: 700 }}>Nexora</span>
          <span style={{ fontSize: '10px', color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: '-2px' }}>AI File Manager</span>
        </div>
      </div>

      <nav className="sidebar-nav">
        {sections.map(section => (
          <div key={section}>
            <div className="nav-section-label">{section}</div>
            {navItems
              .filter(item => item.section === section)
              .map(item => (
                <div
                  key={item.id}
                  className={`nav-item ${currentPage === item.id ? 'active' : ''}`}
                  onClick={() => setPage(item.id)}
                  role="button"
                  tabIndex={0}
                  aria-label={item.label}
                  aria-current={currentPage === item.id ? 'page' : undefined}
                  onKeyDown={(e) => e.key === 'Enter' && setPage(item.id)}
                >
                  <span className="nav-icon">{item.icon}</span>
                  <span className="nav-label">{item.label}</span>
                  {item.badge !== undefined && item.badge > 0 && (
                    <span className="nav-badge">{item.badge}</span>
                  )}
                </div>
              ))}
          </div>
        ))}
      </nav>

      <div
        className="sidebar-toggle"
        onClick={toggleSidebar}
        role="button"
        tabIndex={0}
        aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        onKeyDown={(e) => e.key === 'Enter' && toggleSidebar()}
      >
        {sidebarCollapsed ? '→' : '←'}
      </div>
    </aside>
  );
};
