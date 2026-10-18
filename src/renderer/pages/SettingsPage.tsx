// ============================================================================
// Nexora — Settings Page
// System preferences, AI model parameters, adaptive hardware profiles, and telemetry
// ============================================================================

import React, { useState, useEffect } from 'react';
import { api } from '../services/api';
import {
  DEFAULT_SETTINGS,
  type AppSettings,
  type HardwareMetrics,
  type JobQueueStats,
  type ResourceProfile,
} from '@shared/types';

export const SettingsPage: React.FC = () => {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [savedMessage, setSavedMessage] = useState(false);
  const [appPaths, setAppPaths] = useState<Record<string, string>>({});
  const [appVersion, setAppVersion] = useState<string>('0.5.0');
  const [metrics, setMetrics] = useState<HardwareMetrics | null>(null);
  const [queueStats, setQueueStats] = useState<JobQueueStats | null>(null);
  const [modelManifest, setModelManifest] = useState<any>(null);
  const [isTogglingQueue, setIsTogglingQueue] = useState(false);
  const [llmStatus, setLlmStatus] = useState<import('@shared/types').LlmStatus | null>(null);

  useEffect(() => {
    loadSettings();
    refreshTelemetry();

    const interval = setInterval(() => {
      refreshTelemetry();
    }, 3000);

    return () => clearInterval(interval);
  }, []);

  async function loadSettings() {
    try {
      const [stored, paths, version, manifest, llmStat] = await Promise.all([
        api().settings.getAll() as Promise<Record<string, unknown>>,
        api().app.getPaths(),
        api().app.getVersion(),
        api().ai.getModelManifest().catch(() => null),
        api().llm.getStatus().catch(() => null),
      ]);

      setAppPaths(paths || {});
      setAppVersion(version || '0.5.0');
      if (manifest) setModelManifest(manifest);
      if (llmStat) setLlmStatus(llmStat);

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

  async function refreshTelemetry() {
    try {
      const [m, q] = await Promise.all([
        api().system.getHardwareMetrics(),
        api().system.getQueueStats(),
      ]);
      setMetrics(m);
      setQueueStats(q);
    } catch (err) {
      console.error('Failed to refresh hardware telemetry:', err);
    }
  }

  async function handleSave() {
    try {
      for (const [key, val] of Object.entries(settings)) {
        await api().settings.set(key, val);
      }
      setSavedMessage(true);
      setTimeout(() => setSavedMessage(false), 3000);
      refreshTelemetry();
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

  async function handleTogglePauseQueue() {
    if (!queueStats || isTogglingQueue) return;
    setIsTogglingQueue(true);
    try {
      if (queueStats.isPaused) {
        await api().system.resumeAllJobs();
      } else {
        await api().system.pauseAllJobs();
      }
      await refreshTelemetry();
    } catch (err) {
      console.error('Failed to toggle queue pause status:', err);
    } finally {
      setIsTogglingQueue(false);
    }
  }

  const profiles: Array<{ id: ResourceProfile; label: string; desc: string; icon: string }> = [
    {
      id: 'auto',
      label: 'Auto (Adaptive)',
      desc: 'Dynamically adapts to current CPU and memory pressure with hysteresis dampening.',
      icon: '⚡',
    },
    {
      id: 'low',
      label: 'Low Resource',
      desc: 'Minimal concurrency, small memory batches, CPU-friendly. AI deferred under load.',
      icon: '🌱',
    },
    {
      id: 'balanced',
      label: 'Balanced',
      desc: 'Moderate concurrency with background AI processing. Ideal for everyday use.',
      icon: '⚖️',
    },
    {
      id: 'performance',
      label: 'Performance',
      desc: 'Higher concurrency, streaming hashing, and GPU acceleration when available.',
      icon: '🚀',
    },
  ];

  return (
    <div className="page-content animate-fadeIn" style={{ maxWidth: '960px', paddingBottom: 'var(--space-8)' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-6)' }}>
        <div>
          <h2 style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 700, marginBottom: 'var(--space-1)' }}>
            Application Settings
          </h2>
          <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)' }}>
            Configure local AI models, adaptive hardware profiles, background processing, and data safety.
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
        {/* Resource Profile Selection */}
        <div className="card" style={{ padding: 'var(--space-5)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
            <h3 style={{ fontSize: 'var(--font-size-md)', fontWeight: 600 }}>
              Hardware & Resource Profile
            </h3>
            {metrics && (
              <span className="badge badge-info" style={{ fontSize: '11px', textTransform: 'uppercase' }}>
                Active Profile: {metrics.activeProfile}
              </span>
            )}
          </div>
          <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', marginBottom: 'var(--space-4)' }}>
            Select how Nexora balances responsiveness against indexing speed. Nexora never reserves unneeded RAM or spins up heavy AI when resources are tight.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 'var(--space-3)' }}>
            {profiles.map(p => {
              const isSelected = settings.resourceProfile === p.id;
              return (
                <div
                  key={p.id}
                  onClick={() => setSettings(s => ({ ...s, resourceProfile: p.id }))}
                  style={{
                    padding: 'var(--space-4)',
                    borderRadius: 'var(--radius-md)',
                    border: `1px solid ${isSelected ? 'var(--color-accent)' : 'var(--color-border)'}`,
                    background: isSelected ? 'var(--color-accent-dim)' : 'var(--color-bg-tertiary)',
                    cursor: 'pointer',
                    transition: 'all var(--transition-fast)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 'var(--space-1)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 'var(--font-size-lg)' }}>{p.icon}</span>
                    <input
                      type="radio"
                      name="resourceProfile"
                      checked={isSelected}
                      onChange={() => setSettings(s => ({ ...s, resourceProfile: p.id }))}
                      style={{ cursor: 'pointer' }}
                    />
                  </div>
                  <div style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)', color: isSelected ? 'var(--color-accent)' : 'var(--color-text-primary)' }}>
                    {p.label}
                  </div>
                  <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', lineHeight: 1.4 }}>
                    {p.desc}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Live Hardware Telemetry & Throttling Transparency */}
        <div className="card" style={{ padding: 'var(--space-5)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
            <h3 style={{ fontSize: 'var(--font-size-md)', fontWeight: 600 }}>
              Live Hardware Telemetry
            </h3>
            {metrics?.isThrottled ? (
              <span className="badge badge-warning animate-pulse" style={{ fontSize: '11px' }}>
                ⚠️ Throttled: {metrics.throttleReason || 'Resource Pressure'}
              </span>
            ) : (
              <span className="badge badge-success" style={{ fontSize: '11px' }}>
                ✓ Optimal Performance
              </span>
            )}
          </div>
          <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', marginBottom: 'var(--space-4)' }}>
            Real-time telemetry sampled directly from Windows APIs. Hardware metrics are non-privileged and never fabricated.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 'var(--space-4)' }}>
            {/* CPU */}
            <div style={{ background: 'var(--color-bg-tertiary)', padding: 'var(--space-3)', borderRadius: 'var(--radius-sm)' }}>
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)', marginBottom: '4px' }}>
                PROCESSOR (CPU)
              </div>
              <div style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)', color: 'var(--color-text-primary)' }}>
                {metrics ? `${metrics.cpuCores} Cores (${metrics.cpuLoadPercent}% load)` : 'Detecting...'}
              </div>
              <div style={{ fontSize: '11px', color: 'var(--color-text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: '2px' }}>
                {metrics?.cpuModel || 'CPU Model'}
              </div>
            </div>

            {/* RAM */}
            <div style={{ background: 'var(--color-bg-tertiary)', padding: 'var(--space-3)', borderRadius: 'var(--radius-sm)' }}>
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)', marginBottom: '4px' }}>
                SYSTEM MEMORY (RAM)
              </div>
              <div style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)', color: 'var(--color-text-primary)' }}>
                {metrics
                  ? `${(metrics.usedMemoryBytes / (1024 ** 3)).toFixed(1)} GB / ${(metrics.totalMemoryBytes / (1024 ** 3)).toFixed(1)} GB`
                  : 'Detecting...'}
              </div>
              <div style={{ fontSize: '11px', color: 'var(--color-text-secondary)', marginTop: '2px' }}>
                {metrics ? `${metrics.memoryPressurePercent}% memory pressure` : '—'}
              </div>
            </div>

            {/* GPU */}
            <div style={{ background: 'var(--color-bg-tertiary)', padding: 'var(--space-3)', borderRadius: 'var(--radius-sm)' }}>
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)', marginBottom: '4px' }}>
                ACCELERATION & GPU
              </div>
              <div style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)', color: 'var(--color-text-primary)' }}>
                {metrics?.accelerationProvider || 'CPU'}
                {metrics?.gpuVramBytes ? ` (${(metrics.gpuVramBytes / (1024 ** 3)).toFixed(1)} GB VRAM)` : ''}
              </div>
              <div style={{ fontSize: '11px', color: 'var(--color-text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: '2px' }}>
                {metrics?.gpuName || 'CPU Fallback'}
              </div>
            </div>

            {/* Disk */}
            <div style={{ background: 'var(--color-bg-tertiary)', padding: 'var(--space-3)', borderRadius: 'var(--radius-sm)' }}>
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)', marginBottom: '4px' }}>
                PRIMARY STORAGE
              </div>
              <div style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)', color: 'var(--color-text-primary)' }}>
                {metrics?.primaryDiskType || 'Unknown'} Disk
              </div>
              <div style={{ fontSize: '11px', color: 'var(--color-text-secondary)', marginTop: '2px' }}>
                Sequential seek optimized
              </div>
            </div>
          </div>
        </div>

        {/* Job Queue Transparency & Master Pause/Resume */}
        <div className="card" style={{ padding: 'var(--space-5)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
              <h3 style={{ fontSize: 'var(--font-size-md)', fontWeight: 600 }}>
                Background Job Queue & Controls
              </h3>
              {queueStats?.isWaitingForIdle && (
                <span className="badge badge-warning animate-pulse" style={{ fontSize: '11px' }}>
                  ⏳ Waiting for Idle CPU/RAM
                </span>
              )}
              {queueStats?.isPaused && (
                <span className="badge badge-warning" style={{ fontSize: '11px' }}>
                  ⏸ Paused
                </span>
              )}
            </div>
            <button
              className={`btn btn-sm ${queueStats?.isPaused ? 'btn-primary' : 'btn-secondary'}`}
              onClick={handleTogglePauseQueue}
              disabled={isTogglingQueue}
            >
              {queueStats?.isPaused ? '▶ Resume Background Work' : '⏸ Pause Background Work'}
            </button>
          </div>
          <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', marginBottom: 'var(--space-4)' }}>
            Persistent job queue ensures zero lost work, atomic progress checkpoints, and graceful recovery across crashes.
            {queueStats && queueStats.pendingAiFiles > 0 && (
              <span style={{ color: 'var(--color-accent)', marginLeft: '6px' }}>
                ({queueStats.pendingAiFiles} files queued for deferred background AI analysis)
              </span>
            )}
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 'var(--space-3)' }}>
            <div style={{ background: 'var(--color-bg-tertiary)', padding: 'var(--space-3)', borderRadius: 'var(--radius-sm)', textAlign: 'center' }}>
              <div style={{ fontSize: 'var(--font-size-xl)', fontWeight: 700, color: 'var(--color-accent)' }}>
                {queueStats?.activeJobs ?? 0}
              </div>
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>Active</div>
            </div>

            <div style={{ background: 'var(--color-bg-tertiary)', padding: 'var(--space-3)', borderRadius: 'var(--radius-sm)', textAlign: 'center' }}>
              <div style={{ fontSize: 'var(--font-size-xl)', fontWeight: 700, color: 'var(--color-text-primary)' }}>
                {queueStats?.queuedJobs ?? 0}
              </div>
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>Queued</div>
            </div>

            <div style={{ background: 'var(--color-bg-tertiary)', padding: 'var(--space-3)', borderRadius: 'var(--radius-sm)', textAlign: 'center' }}>
              <div style={{ fontSize: 'var(--font-size-xl)', fontWeight: 700, color: (queueStats?.pendingAiFiles ?? 0) > 0 ? 'var(--color-accent)' : 'var(--color-text-primary)' }}>
                {queueStats?.pendingAiFiles ?? 0}
              </div>
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>Pending AI</div>
            </div>

            <div style={{ background: 'var(--color-bg-tertiary)', padding: 'var(--space-3)', borderRadius: 'var(--radius-sm)', textAlign: 'center' }}>
              <div style={{ fontSize: 'var(--font-size-xl)', fontWeight: 700, color: 'var(--color-warning)' }}>
                {queueStats?.pausedJobs ?? 0}
              </div>
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>Paused</div>
            </div>

            <div style={{ background: 'var(--color-bg-tertiary)', padding: 'var(--space-3)', borderRadius: 'var(--radius-sm)', textAlign: 'center' }}>
              <div style={{ fontSize: 'var(--font-size-xl)', fontWeight: 700, color: 'var(--color-error)' }}>
                {queueStats?.failedJobs ?? 0}
              </div>
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>Failed</div>
            </div>

            <div style={{ background: 'var(--color-bg-tertiary)', padding: 'var(--space-3)', borderRadius: 'var(--radius-sm)', textAlign: 'center' }}>
              <div style={{ fontSize: 'var(--font-size-xl)', fontWeight: 700, color: 'var(--color-text-secondary)' }}>
                {queueStats?.completedJobs ?? 0}
              </div>
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>Completed</div>
            </div>

            <div style={{ background: 'var(--color-bg-tertiary)', padding: 'var(--space-3)', borderRadius: 'var(--radius-sm)', textAlign: 'center' }}>
              <div style={{ fontSize: 'var(--font-size-xl)', fontWeight: 700, color: 'var(--color-text-primary)' }}>
                {(queueStats?.processingRatePerSec ?? 0).toFixed(1)}
              </div>
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>Items / Sec</div>
            </div>
          </div>
        </div>

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

        {/* AI & Worker Tuning */}
        <div className="card" style={{ padding: 'var(--space-5)' }}>
          <h3 style={{ fontSize: 'var(--font-size-md)', fontWeight: 600, marginBottom: 'var(--space-2)' }}>
            AI & Processing Controls
          </h3>
          <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', marginBottom: 'var(--space-4)' }}>
            Configure local AI models, parallel concurrency limits, and idle-only processing.
          </p>

          {/* Background AI Toggles */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', marginBottom: 'var(--space-5)' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={settings.enableBackgroundAi}
                onChange={e => setSettings({ ...settings, enableBackgroundAi: e.target.checked })}
              />
              <div>
                <div style={{ fontWeight: 500, fontSize: 'var(--font-size-sm)' }}>
                  Enable Background AI Processing
                </div>
                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>
                  Automatically detect faces and analyze video keyframes in the background. When disabled, metadata and file organizing remain fully functional.
                </div>
              </div>
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={settings.runAiOnlyWhenIdle}
                onChange={e => setSettings({ ...settings, runAiOnlyWhenIdle: e.target.checked })}
              />
              <div>
                <div style={{ fontWeight: 500, fontSize: 'var(--font-size-sm)' }}>
                  Run Intensive AI Only When System is Idle
                </div>
                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>
                  Defers face embeddings and video frame decoding until CPU usage is below 30% to keep the PC completely responsive.
                </div>
              </div>
            </label>
          </div>

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

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 'var(--space-4)', marginTop: 'var(--space-4)' }}>
            <div>
              <label style={{ display: 'block', fontSize: 'var(--font-size-sm)', fontWeight: 500, marginBottom: 'var(--space-2)' }}>
                Video Sampling (seconds): {settings.videoSamplingInterval}s
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
                Max CPU Workers: {settings.maxCpuWorkers}
              </label>
              <input
                type="number"
                min="1"
                max="8"
                value={settings.maxCpuWorkers}
                onChange={e => setSettings({ ...settings, maxCpuWorkers: parseInt(e.target.value) || 2 })}
                style={{ width: '100%' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 'var(--font-size-sm)', fontWeight: 500, marginBottom: 'var(--space-2)' }}>
                Max Disk Workers: {settings.maxDiskWorkers}
              </label>
              <input
                type="number"
                min="1"
                max="4"
                value={settings.maxDiskWorkers}
                onChange={e => setSettings({ ...settings, maxDiskWorkers: parseInt(e.target.value) || 1 })}
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

        {/* Bundled Offline AI Models & Manifest */}
        <div className="card" style={{ padding: 'var(--space-5)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-3)' }}>
            <h3 style={{ fontSize: 'var(--font-size-md)', fontWeight: 600 }}>
              Bundled Offline AI Models & Integrity Verification
            </h3>
            <span
              style={{
                fontSize: 'var(--font-size-xs)',
                fontWeight: 600,
                padding: '2px 8px',
                borderRadius: '4px',
                background: 'rgba(57, 255, 20, 0.1)',
                color: 'var(--color-primary, #39ff14)',
                border: '1px solid rgba(57, 255, 20, 0.3)',
              }}
            >
              100% Offline & Local-First
            </span>
          </div>
          <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', marginBottom: 'var(--space-4)' }}>
            All required AI neural models are bundled directly into the installation package and cryptographically verified against SHA-256 hashes prior to initialization. Zero internet downloads or cloud API connections.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {modelManifest?.models?.length ? (
              modelManifest.models.map((m: any, idx: number) => (
                <div
                  key={idx}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: 'var(--space-3)',
                    background: 'var(--color-surface-hover, #181818)',
                    borderRadius: 'var(--radius-sm, 6px)',
                    border: '1px solid var(--color-border, #2a2a2a)',
                    fontSize: 'var(--font-size-xs)',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>
                      {m.name} <span style={{ opacity: 0.6, fontWeight: 400 }}>({m.filename})</span>
                    </div>
                    <div style={{ color: 'var(--color-text-tertiary)', marginTop: '2px' }}>
                      {m.description} • {m.license} License • Runtime: {m.runtime}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 'var(--space-3)' }}>
                    <span
                      style={{
                        padding: '2px 6px',
                        borderRadius: '4px',
                        fontSize: '11px',
                        fontWeight: 600,
                        background: m.verified ? 'rgba(57, 255, 20, 0.15)' : 'rgba(255, 59, 48, 0.15)',
                        color: m.verified ? '#39ff14' : '#ff453a',
                      }}
                    >
                      {m.verified ? 'Verified & Bundled' : 'Integrity Error'}
                    </span>
                    <div style={{ fontSize: '10px', color: 'var(--color-text-tertiary)', marginTop: '2px' }}>
                      {(m.size_bytes / 1024 / 1024).toFixed(2)} MB
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div style={{ color: 'var(--color-text-tertiary)', fontSize: 'var(--font-size-xs)' }}>
                Offline models catalog bundled in resources/models.
              </div>
            )}
          </div>
        </div>

        {/* Local LLM Engine (Ollama / Qwen3 4B) */}
        <div className="card" style={{ padding: 'var(--space-5)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-3)' }}>
            <h3 style={{ fontSize: 'var(--font-size-md)', fontWeight: 600 }}>
              Local Large Language Model (Ollama)
            </h3>
            {llmStatus && (
              <span
                style={{
                  fontSize: 'var(--font-size-xs)',
                  fontWeight: 600,
                  padding: '2px 8px',
                  borderRadius: '4px',
                  background: llmStatus.isModelReady
                    ? 'rgba(57, 255, 20, 0.15)'
                    : llmStatus.isAvailable
                    ? 'rgba(255, 179, 0, 0.15)'
                    : 'rgba(255, 59, 48, 0.15)',
                  color: llmStatus.isModelReady
                    ? '#39ff14'
                    : llmStatus.isAvailable
                    ? '#ffb300'
                    : '#ff453a',
                  border: `1px solid ${
                    llmStatus.isModelReady
                      ? 'rgba(57, 255, 20, 0.3)'
                      : llmStatus.isAvailable
                      ? 'rgba(255, 179, 0, 0.3)'
                      : 'rgba(255, 59, 48, 0.3)'
                  }`,
                }}
              >
                {llmStatus.state === 'completed'
                  ? 'Ready (On-Device)'
                  : llmStatus.state === 'model_missing'
                  ? 'Model Missing'
                  : llmStatus.state === 'unavailable'
                  ? 'Ollama Offline'
                  : llmStatus.state}
              </span>
            )}
          </div>
          <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', marginBottom: 'var(--space-4)' }}>
            Nexora communicates strictly with local Ollama at <code style={{ color: 'var(--color-accent)' }}>{settings.ollamaBaseUrl || 'http://127.0.0.1:11434'}</code>. Zero cloud fallback, zero telemetry, and zero remote API keys.
          </p>

          {llmStatus?.errorMessage && (
            <div
              style={{
                background: 'rgba(255, 59, 48, 0.1)',
                border: '1px solid rgba(255, 59, 48, 0.25)',
                borderRadius: 'var(--radius-sm)',
                padding: 'var(--space-3)',
                marginBottom: 'var(--space-4)',
                fontSize: 'var(--font-size-xs)',
                color: '#ff453a',
              }}
            >
              ⚠️ <strong>LLM Status Notice:</strong> {llmStatus.errorMessage}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
            <div>
              <label style={{ display: 'block', fontSize: 'var(--font-size-sm)', fontWeight: 500, marginBottom: 'var(--space-2)' }}>
                Target Ollama Model
              </label>
              <input
                type="text"
                value={settings.ollamaModel || 'qwen3:4b'}
                onChange={(e) => setSettings({ ...settings, ollamaModel: e.target.value.trim() })}
                placeholder="e.g. qwen3:4b or llama3.2:1b"
                style={{ width: '100%' }}
              />
              <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)', marginTop: '4px', display: 'block' }}>
                Default: <code>qwen3:4b</code>. Installed in Ollama: {llmStatus?.availableModels?.map((m) => m.name).join(', ') || 'None detected'}
              </span>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 'var(--font-size-sm)', fontWeight: 500, marginBottom: 'var(--space-2)' }}>
                Ollama Local API Endpoint
              </label>
              <input
                type="text"
                value={settings.ollamaBaseUrl || 'http://127.0.0.1:11434'}
                onChange={(e) => setSettings({ ...settings, ollamaBaseUrl: e.target.value.trim() })}
                style={{ width: '100%' }}
              />
              <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)', marginTop: '4px', display: 'block' }}>
                Loopback address only. Cloud URLs are strictly prohibited.
              </span>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 'var(--font-size-sm)', fontWeight: 500, marginBottom: 'var(--space-2)' }}>
                Context Window (tokens): {settings.ollamaContextWindow || 8192}
              </label>
              <input
                type="number"
                min="2048"
                max="32768"
                step="1024"
                value={settings.ollamaContextWindow || 8192}
                onChange={(e) => setSettings({ ...settings, ollamaContextWindow: parseInt(e.target.value) || 8192 })}
                style={{ width: '100%' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 'var(--font-size-sm)', fontWeight: 500, marginBottom: 'var(--space-2)' }}>
                Temperature: {settings.ollamaTemperature ?? 0.1}
              </label>
              <input
                type="number"
                min="0.0"
                max="0.8"
                step="0.05"
                value={settings.ollamaTemperature ?? 0.1}
                onChange={(e) => setSettings({ ...settings, ollamaTemperature: parseFloat(e.target.value) || 0.1 })}
                style={{ width: '100%' }}
              />
              <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)', marginTop: '4px', display: 'block' }}>
                Recommended: 0.0 - 0.2 for deterministic categorization.
              </span>
            </div>
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
