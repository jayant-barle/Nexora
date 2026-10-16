// ============================================================================
// Nexora — Settings Page
// System preferences, AI model parameters, library paths, and hardware tuning
// ============================================================================

import React, { useState, useEffect } from 'react';
import { api } from '../services/api';
import { DEFAULT_SETTINGS, type AppSettings } from '@shared/types';

export const SettingsPage: React.FC = () => {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [savedMessage, setSavedMessage] = useState(false);
  const [appPaths, setAppPaths] = useState<Record<string, string>>({});
  const [appVersion, setAppVersion] = useState<string>('0.1.0');

  useEffect(() => {
    loadSettings();
  }, []);

  async function loadSettings() {
    try {
      const [stored, paths, version] = await Promise.all([
        api().settings.getAll() as Promise<Record<string, unknown>>,
        api().app.getPaths(),
        api().app.getVersion(),
      ]);

      setAppPaths(paths || {});
      setAppVersion(version || '0.1.0');

      if (stored && Object.keys(stored).length > 0) {
        setSettings(prev => ({
          ...prev,
          ...stored,
        }));
      }
    } catch (err) {
      console.error('Failed to load settings:', err);
    }
  }

  async function handleSave() {
    try {
      for (const [key, val] of Object.entries(settings)) {
        await api().settings.set(key, val);
      }
      setSavedMessage(true);
      setTimeout(() => setSavedMessage(false), 3000);
    } catch (err) {
      console.error('Failed to save settings:', err);
    }
  }

  async function handleSelectLibraryPath() {
    try {
      const selected = await api().dialog.openFolder();
      if (selected) {
        setSettings(prev => ({ ...prev, managedLibraryPath: selected }));
      }
    } catch (err) {
      console.error('Failed to choose library folder:', err);
    }
  }

  return (
    <div className="page-content animate-fadeIn" style={{ maxWidth: '900px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-6)' }}>
        <div>
          <h2 style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 700, marginBottom: 'var(--space-1)' }}>
            Application Settings
          </h2>
          <p style={{ color: 'var(--color-text-secondary)' }}>
            Configure local AI models, library structure, processing performance, and safety checks.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          {savedMessage && (
            <span className="badge badge-success animate-fadeIn">✓ Settings Saved</span>
          )}
          <button className="btn btn-primary" onClick={handleSave}>
            Save Changes
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
        {/* Managed Library Location */}
        <div className="card" style={{ padding: 'var(--space-5)' }}>
          <h3 style={{ fontSize: 'var(--font-size-md)', fontWeight: 600, marginBottom: 'var(--space-2)' }}>
            Library & Storage Location
          </h3>
          <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', marginBottom: 'var(--space-4)' }}>
            Designated destination folder where organized photos and videos are stored safely without altering your original files.
          </p>

          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <input
              type="text"
              value={settings.managedLibraryPath || ''}
              placeholder="e.g. D:\AI Library\Organized"
              readOnly
              style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-xs)' }}
            />
            <button className="btn btn-secondary" onClick={handleSelectLibraryPath}>
              Browse Folder...
            </button>
          </div>
        </div>

        {/* AI & Face Recognition Tuning */}
        <div className="card" style={{ padding: 'var(--space-5)' }}>
          <h3 style={{ fontSize: 'var(--font-size-md)', fontWeight: 600, marginBottom: 'var(--space-2)' }}>
            Face Detection & AI Parameters
          </h3>
          <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', marginBottom: 'var(--space-4)' }}>
            Tune neural model confidence thresholds to minimize false positive face recognitions.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
            <div>
              <label style={{ display: 'block', fontSize: 'var(--font-size-sm)', fontWeight: 500, marginBottom: 'var(--space-2)' }}>
                Detection Confidence: {settings.faceDetectionConfidence}
              </label>
              <input
                type="range"
                min="0.4"
                max="0.95"
                step="0.05"
                value={settings.faceDetectionConfidence}
                onChange={e => setSettings({ ...settings, faceDetectionConfidence: parseFloat(e.target.value) })}
                style={{ width: '100%' }}
              />
              <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)' }}>
                Higher values detect fewer blurry faces but eliminate false detections.
              </span>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 'var(--font-size-sm)', fontWeight: 500, marginBottom: 'var(--space-2)' }}>
                Cluster Distance Threshold: {settings.faceClusteringThreshold}
              </label>
              <input
                type="range"
                min="0.3"
                max="0.8"
                step="0.05"
                value={settings.faceClusteringThreshold}
                onChange={e => setSettings({ ...settings, faceClusteringThreshold: parseFloat(e.target.value) })}
                style={{ width: '100%' }}
              />
              <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)' }}>
                Lower values group strictly; higher values merge distant face variations.
              </span>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)', marginTop: 'var(--space-4)' }}>
            <div>
              <label style={{ display: 'block', fontSize: 'var(--font-size-sm)', fontWeight: 500, marginBottom: 'var(--space-2)' }}>
                Video Keyframe Interval (seconds): {settings.videoSamplingInterval}s
              </label>
              <input
                type="number"
                min="1"
                max="60"
                value={settings.videoSamplingInterval}
                onChange={e => setSettings({ ...settings, videoSamplingInterval: parseInt(e.target.value) || 5 })}
                style={{ width: '100%' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 'var(--font-size-sm)', fontWeight: 500, marginBottom: 'var(--space-2)' }}>
                Parallel Worker Threads: {settings.maxConcurrentJobs}
              </label>
              <input
                type="number"
                min="1"
                max="8"
                value={settings.maxConcurrentJobs}
                onChange={e => setSettings({ ...settings, maxConcurrentJobs: parseInt(e.target.value) || 2 })}
                style={{ width: '100%' }}
              />
            </div>
          </div>
        </div>

        {/* Safety & Hash Verification */}
        <div className="card" style={{ padding: 'var(--space-5)' }}>
          <h3 style={{ fontSize: 'var(--font-size-md)', fontWeight: 600, marginBottom: 'var(--space-2)' }}>
            Safety, Integrity & Verification
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', marginTop: 'var(--space-3)' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={settings.hashVerification}
                onChange={e => setSettings({ ...settings, hashVerification: e.target.checked })}
              />
              <div>
                <div style={{ fontWeight: 500, fontSize: 'var(--font-size-sm)' }}>
                  Mandatory SHA-256 Checksum Verification
                </div>
                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>
                  Always compute and verify destination file hashes before completing file copy operations.
                </div>
              </div>
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={settings.watcherEnabled}
                onChange={e => setSettings({ ...settings, watcherEnabled: e.target.checked })}
              />
              <div>
                <div style={{ fontWeight: 500, fontSize: 'var(--font-size-sm)' }}>
                  Enable Active Windows Filesystem Watcher
                </div>
                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>
                  Automatically detect when new photos or videos are copied into watched directories.
                </div>
              </div>
            </label>
          </div>
        </div>

        {/* System & Diagnostics Info */}
        <div className="card" style={{ padding: 'var(--space-5)' }}>
          <h3 style={{ fontSize: 'var(--font-size-md)', fontWeight: 600, marginBottom: 'var(--space-3)' }}>
            Diagnostic Environment
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: 'var(--space-2)', fontSize: 'var(--font-size-xs)' }}>
            <span style={{ color: 'var(--color-text-tertiary)' }}>Application Version:</span>
            <span style={{ fontFamily: 'var(--font-mono)' }}>v{appVersion}</span>

            <span style={{ color: 'var(--color-text-tertiary)' }}>User Data Directory:</span>
            <span style={{ fontFamily: 'var(--font-mono)', wordBreak: 'break-all' }}>{appPaths.userData || '—'}</span>

            <span style={{ color: 'var(--color-text-tertiary)' }}>Local Database:</span>
            <span style={{ fontFamily: 'var(--font-mono)', wordBreak: 'break-all' }}>
              {appPaths.userData ? `${appPaths.userData}\\nexora.db` : '—'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
