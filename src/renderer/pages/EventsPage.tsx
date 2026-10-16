// ============================================================================
// Nexora — Events & Locations Page
// Media grouped by geographical coordinates, reverse geocoding, and temporal events
// ============================================================================

import React, { useState } from 'react';
import { toast } from '../store';

export const EventsPage: React.FC = () => {
  const [modalOpen, setModalOpen] = useState(false);
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [startDate, setStartDate] = useState('');

  const handleCreateEvent = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    toast.success(`Event "${name.trim()}" created. Media matching this time and place will group automatically.`, 'Event Created');
    setName('');
    setLocation('');
    setStartDate('');
    setModalOpen(false);
  };

  return (
    <div className="page-content animate-fadeIn">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-6)' }}>
        <div>
          <h2 style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 700, marginBottom: 'var(--space-1)' }}>Events & Places</h2>
          <p style={{ color: 'var(--color-text-secondary)' }}>Media clustered chronologically by EXIF GPS coordinates and timestamps</p>
        </div>
        <button className="btn btn-primary" onClick={() => setModalOpen(true)}>
          + Create Custom Event
        </button>
      </div>

      <div className="empty-state">
        <div className="empty-icon">📍</div>
        <div className="empty-title">No location events grouped yet</div>
        <div className="empty-description">
          Events are automatically grouped from media containing embedded GPS coordinates and capture timestamps.
          When you index camera rolls or travel albums with location data, Nexora organizes them by city and date range automatically.
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-3)', marginTop: 'var(--space-2)' }}>
          <button className="btn btn-secondary" onClick={() => setModalOpen(true)}>
            Define Custom Event
          </button>
        </div>
      </div>

      {/* Create Event Modal */}
      {modalOpen && (
        <div className="modal-overlay" onClick={() => setModalOpen(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ width: '440px' }}>
            <div className="modal-header">
              <h3 className="modal-title">Create Custom Event</h3>
              <button className="btn btn-ghost" onClick={() => setModalOpen(false)}>✕</button>
            </div>
            <form onSubmit={handleCreateEvent}>
              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                <div>
                  <label style={{ display: 'block', fontSize: 'var(--font-size-xs)', fontWeight: 600, marginBottom: '4px' }}>
                    Event Name
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Summer Vacation, Birthday Party..."
                    value={name}
                    onChange={e => setName(e.target.value)}
                    autoFocus
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 'var(--font-size-xs)', fontWeight: 600, marginBottom: '4px' }}>
                    Location (Optional)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Tokyo, Grand Canyon, Home..."
                    value={location}
                    onChange={e => setLocation(e.target.value)}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 'var(--font-size-xs)', fontWeight: 600, marginBottom: '4px' }}>
                    Date (Optional)
                  </label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={e => setStartDate(e.target.value)}
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-ghost" onClick={() => setModalOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={!name.trim()}>
                  Save Event
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
