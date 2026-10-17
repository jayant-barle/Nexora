// ============================================================================
// Nexora — People Page
// Local face recognition clusters, identity confirmation, and user review
// ============================================================================

import React, { useEffect, useState } from 'react';
import { usePeopleStore, toast } from '../store';
import { api } from '../services/api';

export const PeoplePage: React.FC = () => {
  const { people, loading, fetchPeople, updatePerson, deletePerson } = usePeopleStore();
  const [filter, setFilter] = useState<'all' | 'unreviewed' | 'reviewed' | 'confirmed'>('all');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [isClustering, setIsClustering] = useState(false);

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
    setDeleteConfirmId(null);
  };

  const handleSaveRename = async () => {
    if (editingId) {
      await updatePerson(editingId, { name: editName.trim() || null });
      toast.success(`Person updated to "${editName.trim() || 'Unknown'}"`, 'Identity Saved');
      setEditingId(null);
    }
  };

  const handleConfirm = async (id: string, name?: string | null) => {
    await updatePerson(id, { review_status: 'confirmed' });
    toast.success(`Identity confirmed for ${name || 'person'}`, 'Confirmed');
  };

  const handleHide = async (id: string) => {
    await updatePerson(id, { is_hidden: true });
    toast.info('Person hidden from default view', 'Person Hidden');
  };

  const handleDelete = async (id: string) => {
    await deletePerson(id);
    setDeleteConfirmId(null);
    toast.info('Person removed. Original files remain untouched on disk.', 'Person Deleted');
  };

  const handleRecluster = async () => {
    setIsClustering(true);
    try {
      toast.info('Starting face clustering engine on all unclustered faces...', 'Clustering Faces');
      await api().jobs.create('face_clustering');
      toast.success('Face clustering job scheduled. Discovered identities will appear shortly.', 'Job Dispatched');
      // Refresh people list after a brief delay for clustering execution
      setTimeout(() => {
        fetchPeople();
      }, 2000);
    } catch (err) {
      console.error('Failed to trigger face clustering:', err);
      toast.error(err instanceof Error ? err.message : String(err), 'Clustering Failed');
    } finally {
      setIsClustering(false);
    }
  };

  return (
    <div className="page-content animate-fadeIn">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-6)' }}>
        <div>
          <h2 style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 700, marginBottom: 'var(--space-1)' }}>People & Faces</h2>
          <p style={{ color: 'var(--color-text-secondary)' }}>
            {people.length} {people.length === 1 ? 'person' : 'people'} identified by 100% local face clustering
          </p>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <button
            className="btn btn-secondary btn-sm"
            onClick={fetchPeople}
            disabled={loading}
            title="Refresh people list"
          >
            ↻ Refresh
          </button>
          <button
            className="btn btn-primary btn-sm"
            onClick={handleRecluster}
            disabled={isClustering}
            title="Run local face clustering on detected faces"
          >
            {isClustering ? 'Clustering...' : '⚡ Run Face Clustering'}
          </button>
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
              ? 'Index folders containing photos to detect and cluster faces. All vector embeddings and clustering execute entirely on your PC.'
              : 'Try a different filter to view people.'}
          </div>
          {people.length === 0 && (
            <div style={{ marginTop: 'var(--space-4)' }}>
              <button
                className="btn btn-primary btn-sm"
                onClick={handleRecluster}
                disabled={isClustering}
              >
                {isClustering ? 'Clustering...' : '⚡ Run Face Clustering Now'}
              </button>
            </div>
          )}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 'var(--space-4)' }}>
          {filtered.map(person => (
            <div key={person.id} className="person-card">
              <div className="person-avatar">
                {person.name ? person.name.charAt(0).toUpperCase() : '?'}
              </div>
              
              {editingId === person.id ? (
                <div style={{ display: 'flex', gap: 'var(--space-1)', width: '100%', marginTop: 'var(--space-2)' }}>
                  <input
                    type="text"
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') handleSaveRename();
                      if (e.key === 'Escape') setEditingId(null);
                    }}
                    placeholder="Enter name..."
                    style={{ flex: 1, fontSize: 'var(--font-size-xs)', padding: 'var(--space-1) var(--space-2)' }}
                    autoFocus
                  />
                  <button className="btn btn-primary btn-sm" onClick={handleSaveRename}>✓</button>
                </div>
              ) : (
                <div
                  className="person-name"
                  onClick={() => handleStartRename(person)}
                  style={{ cursor: 'pointer' }}
                  title="Click to rename"
                >
                  {person.name || 'Unknown Person'}
                </div>
              )}

              <div className="person-count">{person.file_count} files</div>
              <span className={`person-status ${person.review_status}`}>
                {person.review_status}
              </span>

              {deleteConfirmId === person.id ? (
                <div style={{ marginTop: 'var(--space-2)', display: 'flex', flexDirection: 'column', gap: '4px', width: '100%' }}>
                  <span style={{ fontSize: '10px', color: 'var(--color-error)', textAlign: 'center' }}>Delete person?</span>
                  <div style={{ display: 'flex', gap: '4px', justifyContent: 'center' }}>
                    <button
                      className="btn btn-sm"
                      style={{ background: 'var(--color-error)', color: '#fff', fontSize: '11px', padding: '2px 8px' }}
                      onClick={() => handleDelete(person.id)}
                    >
                      Delete
                    </button>
                    <button
                      className="btn btn-sm btn-ghost"
                      style={{ fontSize: '11px', padding: '2px 8px' }}
                      onClick={() => setDeleteConfirmId(null)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 'var(--space-1)', marginTop: 'var(--space-2)' }}>
                  {person.review_status !== 'confirmed' && (
                    <button className="btn btn-ghost btn-sm" onClick={() => handleConfirm(person.id, person.name)} title="Confirm identity">✓</button>
                  )}
                  <button className="btn btn-ghost btn-sm" onClick={() => handleStartRename(person)} title="Rename">✎</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => handleHide(person.id)} title="Hide">👁</button>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => setDeleteConfirmId(person.id)}
                    title="Delete Person"
                    style={{ color: 'var(--color-error)' }}
                  >
                    ✕
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
