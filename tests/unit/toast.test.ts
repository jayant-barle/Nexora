// ============================================================================
// Unit Tests: Toast & Desktop In-App Notification Store
// ============================================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useToastStore, toast } from '../../src/renderer/store';

describe('Toast Notification Store', () => {
  beforeEach(() => {
    useToastStore.getState().clearToasts();
    vi.useFakeTimers();
  });

  it('adds success toast with auto-generated id', () => {
    toast.success('File scanned successfully', 'Index Complete');
    const { toasts } = useToastStore.getState();

    expect(toasts).toHaveLength(1);
    expect(toasts[0].type).toBe('success');
    expect(toasts[0].title).toBe('Index Complete');
    expect(toasts[0].message).toBe('File scanned successfully');
    expect(toasts[0].id).toBeDefined();
  });

  it('adds error toast with 6s duration', () => {
    toast.error('Path access denied', 'Permission Error');
    const { toasts } = useToastStore.getState();

    expect(toasts).toHaveLength(1);
    expect(toasts[0].type).toBe('error');
    expect(toasts[0].duration).toBe(6000);
  });

  it('removes toast by id', () => {
    toast.info('Analyzing disks');
    const { toasts, removeToast } = useToastStore.getState();
    const id = toasts[0].id;

    removeToast(id);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('auto-dismisses toast after timer expires', () => {
    toast.warning('Hardware high memory pressure', 'Resource Warning');
    expect(useToastStore.getState().toasts).toHaveLength(1);

    vi.advanceTimersByTime(4500);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });
});
