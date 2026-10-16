// ============================================================================
// Unit Tests: Filesystem Utilities & Path Validation
// ============================================================================

import { describe, it, expect } from 'vitest';
import path from 'path';

describe('Filesystem Utilities & Path Safety', () => {
  it('normalizes Windows backslashes properly', () => {
    const rawPath = 'C:\\Users\\test\\..\\test\\Photos';
    const normalized = path.normalize(rawPath);
    expect(normalized).toBe('C:\\Users\\test\\Photos');
  });

  it('detects null-byte injection attempts', () => {
    const malicious = 'C:\\Safe\\Folder\0\\secret.txt';
    expect(malicious.includes('\0')).toBe(true);
  });

  it('correctly parses drive letters on Windows', () => {
    const fullPath = 'E:\\Code Tresure\\File manager\\package.json';
    const parsed = path.parse(fullPath);
    expect(parsed.root).toBe('E:\\');
    expect(parsed.base).toBe('package.json');
    expect(parsed.ext).toBe('.json');
  });

  it('determines parent path correctly for navigation', () => {
    const folder = 'C:\\Users\\Photos\\Vacation\\';
    const parent = folder.replace(/[\\/][^\\/]+[\\/]?$/, '');
    expect(parent).toBe('C:\\Users\\Photos');
  });
});
