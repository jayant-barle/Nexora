// ============================================================================
// Unit Tests: Shared Types & Default Settings
// ============================================================================

import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/shared/types';

describe('Shared App Settings & Constants', () => {
  it('defines safe default settings for local AI execution', () => {
    expect(DEFAULT_SETTINGS.theme).toBe('dark');
    expect(DEFAULT_SETTINGS.maxConcurrentJobs).toBeGreaterThanOrEqual(1);
    expect(DEFAULT_SETTINGS.faceDetectionConfidence).toBeGreaterThan(0.5);
    expect(DEFAULT_SETTINGS.hashVerification).toBe(true);
  });

  it('sets reasonable debounce time for Windows folder watching', () => {
    expect(DEFAULT_SETTINGS.watcherDebounceMs).toBeGreaterThanOrEqual(1000);
  });
});
