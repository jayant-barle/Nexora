// ============================================================================
// Nexora — Toast Container Component
// Non-intrusive, premium desktop alerts with glassmorphism styling
// ============================================================================

import React from 'react';
import { useToastStore, type ToastType } from '../store';

function getToastIcon(type: ToastType): string {
  switch (type) {
    case 'success':
      return '✓';
    case 'error':
      return '✕';
    case 'warning':
      return '⚠';
    case 'info':
    default:
      return 'ℹ';
  }
}

export const ToastContainer: React.FC = () => {
  const { toasts, removeToast } = useToastStore();

  if (toasts.length === 0) return null;

  return (
    <div className="toast-container" role="region" aria-label="Notifications">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.type}`} role="alert">
          <div className="toast-icon">
            <span
              style={{
                color:
                  t.type === 'success'
                    ? 'var(--color-accent)'
                    : t.type === 'error'
                    ? 'var(--color-error)'
                    : t.type === 'warning'
                    ? 'var(--color-warning)'
                    : 'var(--color-info)',
                fontWeight: 700,
              }}
            >
              {getToastIcon(t.type)}
            </span>
          </div>
          <div className="toast-content">
            {t.title && <div className="toast-title">{t.title}</div>}
            <div className="toast-message">{t.message}</div>
          </div>
          <button
            className="toast-close"
            onClick={() => removeToast(t.id)}
            title="Dismiss notification"
            aria-label="Dismiss notification"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
};
