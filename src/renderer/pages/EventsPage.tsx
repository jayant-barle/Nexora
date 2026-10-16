// ============================================================================
// Nexora — Events & Locations Page
// ============================================================================

import React from 'react';

export const EventsPage: React.FC = () => {
  return (
    <div className="page-content">
      <div style={{ marginBottom: 'var(--space-6)' }}>
        <h2 style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 700, marginBottom: 'var(--space-1)' }}>Events & Places</h2>
        <p style={{ color: 'var(--color-text-secondary)' }}>Media grouped by events and GPS locations</p>
      </div>

      <div className="empty-state">
        <div className="empty-icon">📍</div>
        <div className="empty-title">No events detected yet</div>
        <div className="empty-description">
          Events are automatically grouped from media with timestamps and GPS metadata.
          Index photos with location data to see them organized by place.
          You can also create custom events manually.
        </div>
        <button className="btn btn-secondary">Create Event</button>
      </div>
    </div>
  );
};
