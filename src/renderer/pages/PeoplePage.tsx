// ============================================================================
// Nexora — People Page
// ============================================================================

import React, { useEffect, useState } from 'react';
import { usePeopleStore } from '../store';

export const PeoplePage: React.FC = () => {
  const { people, loading, fetchPeople, updatePerson, deletePerson } = usePeopleStore();
  const [filter, setFilter] = useState<'all' | 'unreviewed' | 'reviewed' | 'confirmed'>('all');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  useEffect(() => {
    fetchPeople();
  }, [fetchPeople]);

  const filtered = people.filter(p => {
    if (filter === 'all') return true;
    return p.review_status === filter;
  });

  const handleStartRename = (person: typeof people[0]) => {
    setEditingId(person.id);
    setEditName(person.name || '');
  };

  const handleSaveRename = async () => {
    if (editingId) {
      await updatePerson(editingId, { name: editName || null });
      setEditingId(null);
    }
  };

  const handleConfirm = async (id: string) => {
    await updatePerson(id, { review_status: 'confirmed' });
  };

  const handleHide = async (id: string) => {
    await updatePerson(id, { is_hidden: true });
  };

  return (
    <div className="page-content">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-6)' }}>
        <div>
          <h2 style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 700, marginBottom: 'var(--space-1)' }}>People</h2>
          <p style={{ color: 'var(--color-text-secondary)' }}>
            {people.length} {people.length === 1 ? 'person' : 'people'} detected
          </p>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="tabs">
        {(['all', 'unreviewed', 'reviewed', 'confirmed'] as const).map(f => (
          <div key={f} className={`tab ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)}>
            {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
            {f === 'unreviewed' && people.filter(p => p.review_status === 'unreviewed').length > 0 && (
              <span style={{ marginLeft: 'var(--space-1)', color: 'var(--color-warning)' }}>
                ({people.filter(p => p.review_status === 'unreviewed').length})
              </span>
            )}
          </div>
        ))}
      </div>

      {loading && people.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon animate-pulse">👤</div>
          <div className="empty-title">Loading people...</div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">👤</div>
          <div className="empty-title">
            {people.length === 0 ? 'No people detected yet' : 'No matches for this filter'}
          </div>
          <div className="empty-description">
            {people.length === 0
              ? 'Index folders containing photos to detect and group faces. All processing happens locally on your machine.'
              : 'Try a different filter to see people.'}
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 'var(--space-4)' }}>
          {filtered.map(person => (
            <div key={person.id} className="person-card">
              <div className="person-avatar">
                {person.name ? person.name.charAt(0).toUpperCase() : '?'}
              </div>
              
              {editingId === person.id ? (
                <div style={{ display: 'flex', gap: 'var(--space-1)', width: '100%' }}>
                  <input
                    type="text"
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleSaveRename()}
                    placeholder="Enter name..."
                    style={{ flex: 1, fontSize: 'var(--font-size-sm)', padding: 'var(--space-1) var(--space-2)' }}
                    autoFocus
                  />
                  <button className="btn btn-primary btn-sm" onClick={handleSaveRename}>✓</button>
                </div>
              ) : (
                <div className="person-name" onClick={() => handleStartRename(person)} style={{ cursor: 'pointer' }}>
                  {person.name || 'Unknown Person'}
                </div>
              )}

              <div className="person-count">{person.file_count} files</div>
              <span className={`person-status ${person.review_status}`}>
                {person.review_status}
              </span>

              <div style={{ display: 'flex', gap: 'var(--space-1)', marginTop: 'var(--space-2)' }}>
                {person.review_status !== 'confirmed' && (
                  <button className="btn btn-ghost btn-sm" onClick={() => handleConfirm(person.id)} title="Confirm identity">✓</button>
                )}
                <button className="btn btn-ghost btn-sm" onClick={() => handleStartRename(person)} title="Rename">✎</button>
                <button className="btn btn-ghost btn-sm" onClick={() => handleHide(person.id)} title="Hide">👁</button>
                <button className="btn btn-ghost btn-sm" onClick={() => {
                  if (confirm('Delete this person and their face associations? Source files will not be affected.')) {
                    deletePerson(person.id);
                  }
                }} title="Delete" style={{ color: 'var(--color-error)' }}>✕</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
