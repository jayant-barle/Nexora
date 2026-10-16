// ============================================================================
// Nexora — History & Organization Operations Page
// Audit log of file reorganization operations with safe undo/rollback capability
// ============================================================================

import React, { useState, useEffect } from 'react';
import { api } from '../services/api';
import { toast } from '../store';
import type { CopyOperation } from '@shared/types';

function formatSize(bytes: number): string {
  if (!bytes || bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

export const HistoryPage: React.FC = () => {
  const [operations, setOperations] = useState<CopyOperation[]>([]);
  const [loading, setLoading] = useState(true);
  const [revertingId, setRevertingId] = useState<string | null>(null);

  useEffect(() => {
    loadHistory();
  }, []);

  async function loadHistory() {
    setLoading(true);
    try {
      const ops = await api().operations.list();
      setOperations((ops as CopyOperation[]) || []);
    } catch (err) {
      console.error('Failed to load history:', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleRollback(operationId: string) {
    if (revertingId) return;
    setRevertingId(operationId);
    try {
      const res = await api().operations.revert(operationId);
      if (res.success) {
        toast.success(
          `Rolled back operation: ${res.revertedFiles} files reverted, ${res.protectedFiles.length} modified user files protected.`,
          'Rollback Completed'
        );
        await loadHistory();
      } else {
        toast.error('Rollback completed with warnings. Check logs for details.', 'Rollback Warning');
      }
    } catch (err) {
      console.error('Rollback error:', err);
      toast.error(err instanceof Error ? err.message : String(err), 'Rollback Failed');
    } finally {
      setRevertingId(null);
    }
  }

  return (
    <div className="page-content animate-fadeIn">
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-6)' }}>
        <div>
          <h2 style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 700, marginBottom: 'var(--space-1)' }}>
            Operations & Rollback History
          </h2>
          <p style={{ color: 'var(--color-text-secondary)' }}>
            Audit trail of non-destructive copies, folder reorganizations, and batch export actions.
          </p>
        </div>
        <button className="btn btn-secondary" onClick={loadHistory} disabled={loading}>
          ↻ Refresh Log
        </button>
      </div>

      {loading ? (
        <div className="empty-state">
          <div className="empty-icon animate-pulse">🕐</div>
          <div className="empty-title">Loading operation history...</div>
        </div>
      ) : operations.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">📜</div>
          <div className="empty-title">No file operations recorded yet</div>
          <div className="empty-description">
            Whenever you run an automated media organization (e.g. organizing photos into Person folders or chronological year/month folders), the transaction is recorded here with checksum verifications and instant one-click rollback.
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {operations.map(op => {
            const isReverted = op.status === 'reverted';
            const isCompleted = op.status === 'completed';

            return (
              <div key={op.id} className="card" style={{ padding: 'var(--space-4)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                      <span className={`badge ${isCompleted ? 'badge-success' : isReverted ? 'badge-secondary' : 'badge-warning'}`}>
                        {op.status.toUpperCase()}
                      </span>
                      <span style={{ fontWeight: 600 }}>{op.type.replace(/_/g, ' ')}</span>
                      {op.created_at && (
                        <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)' }}>
                          • {new Date(op.created_at).toLocaleString()}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)', marginTop: '4px', wordBreak: 'break-all' }}>
                      Destination: {op.destination_root}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                    <div style={{ textAlign: 'right', fontSize: 'var(--font-size-xs)' }}>
                      <div>{op.completed_files} / {op.total_files} files</div>
                      <div style={{ color: 'var(--color-text-secondary)' }}>{formatSize(op.copied_bytes)}</div>
                    </div>
                    {isCompleted && (
                      <button
                        className="btn btn-sm btn-secondary"
                        onClick={() => handleRollback(op.id)}
                        disabled={revertingId === op.id}
                      >
                        {revertingId === op.id ? 'Rolling back...' : '↺ Undo / Rollback'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
