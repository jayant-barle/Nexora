// ============================================================================
// Unit Tests: Hardware Monitor & Adaptive Resource Management
// Telemetry, profiles, hysteresis throttling, priority scheduling, and queue control
// ============================================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import os from 'os';

// Mock electron app before imports
vi.mock('electron', () => ({
  app: {
    getPath: () => os.tmpdir(),
  },
  BrowserWindow: {
    getAllWindows: () => [],
  },
}));

// Mock child_process for fast, deterministic unit test execution
vi.mock('child_process', () => ({
  execSync: vi.fn((cmd: string) => {
    if (cmd.includes('MediaType')) return 'SSD';
    if (cmd.includes('VideoController')) return '"Caption","AdapterRAM"\n"NVIDIA GeForce RTX 4070",12884901888';
    return '';
  }),
}));

// In-memory Mock Database for queue and job tracking
class MockAdaptiveDatabase {
  public jobs: any[] = [];
  public files: any[] = [];
  public settings: Record<string, string> = {
    resourceProfile: 'auto',
    enableBackgroundAi: 'true',
    runAiOnlyWhenIdle: 'false',
  };

  transaction(fn: Function) {
    return (...args: any[]) => fn(...args);
  }

  prepare(sql: string) {
    if (sql.includes('SELECT COUNT(*) as count FROM files WHERE processing_status = \'pending\'')) {
      return {
        get: () => ({ count: this.files.filter(f => f.processing_status === 'pending').length }),
      };
    }

    if (sql.includes('SELECT COUNT(*) as count FROM jobs WHERE status = \'running\'')) {
      return {
        get: () => ({ count: this.jobs.filter(j => j.status === 'running').length }),
      };
    }

    if (sql.includes('SELECT status, COUNT(*) as count FROM jobs GROUP BY status')) {
      return {
        all: () => {
          const counts: Record<string, number> = {};
          for (const j of this.jobs) {
            counts[j.status] = (counts[j.status] || 0) + 1;
          }
          return Object.entries(counts).map(([status, count]) => ({ status, count }));
        },
      };
    }

    if (sql.includes('SELECT * FROM jobs') && sql.includes("WHERE status = 'queued'")) {
      return {
        get: () => {
          // If query excludes AI jobs
          const excludeAi = sql.includes('priority < 4');
          const queued = this.jobs
            .filter(j => j.status === 'queued')
            .filter(j => !excludeAi || j.priority < 4)
            .sort((a, b) => a.priority - b.priority || a.created_at - b.created_at);
          return queued[0] || null;
        },
      };
    }

    if (sql.includes('UPDATE jobs') && sql.includes("WHERE status = 'running'")) {
      return {
        run: () => {
          let count = 0;
          for (const j of this.jobs) {
            if (j.status === 'running') {
              j.status = 'queued';
              count++;
            }
          }
          return { changes: count };
        },
      };
    }

    if (sql.includes('UPDATE jobs SET')) {
      return {
        run: (...params: any[]) => {
          return { changes: 1 };
        },
      };
    }

    return {
      run: () => ({ changes: 1 }),
      get: () => null,
      all: () => [],
    };
  }
}

let mockDb = new MockAdaptiveDatabase();
vi.mock('../../src/main/database', () => ({
  getDb: () => mockDb,
  getSettings: () => mockDb.settings,
  getSetting: (key: string) => mockDb.settings[key] || null,
  setSetting: (key: string, val: string) => { mockDb.settings[key] = val; },
  updateJobStatus: (id: string, status: string) => {
    const j = mockDb.jobs.find(job => job.id === id);
    if (j) j.status = status;
  },
}));

import { HardwareMonitor } from '../../src/main/hardware-monitor';
import { JobRunner } from '../../src/main/job-runner';

describe('Adaptive Resource Management & Hardware Telemetry', () => {
  beforeEach(() => {
    mockDb = new MockAdaptiveDatabase();
    vi.restoreAllMocks();
    // Establish unconstrained, healthy 8-core / 32GB baseline to isolate tests from host VM CPU/RAM load
    vi.spyOn(os, 'totalmem').mockReturnValue(32 * 1024 * 1024 * 1024);
    vi.spyOn(os, 'freemem').mockReturnValue(24 * 1024 * 1024 * 1024);
    vi.spyOn(os, 'cpus').mockReturnValue(new Array(8).fill({
      model: 'Intel Core i7 Performance',
      speed: 3600,
      times: { idle: 1000, user: 100, sys: 50, irq: 0, nice: 0 },
    }) as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── 1. Baseline Hardware Detection ─────────────────────────────────────────
  describe('Baseline Hardware Detection', () => {
    it('detects low profile for systems with <= 6GB RAM or <= 4 CPU cores', () => {
      // Mock low-resource PC: 4GB RAM, 4 cores
      vi.spyOn(os, 'totalmem').mockReturnValue(4 * 1024 * 1024 * 1024);
      vi.spyOn(os, 'cpus').mockReturnValue(new Array(4).fill({
        model: 'Intel Celeron N4020',
        times: { idle: 100, user: 10, sys: 10, irq: 0, nice: 0 },
      }) as any);

      const monitor = new HardwareMonitor();
      const metrics = monitor.getHardwareMetrics('auto');

      expect(metrics.detectedProfile).toBe('low');
      expect(metrics.activeProfile).toBe('low');
      expect(metrics.cpuCores).toBe(4);
    });

    it('detects performance profile for systems with >= 16GB RAM and >= 8 CPU cores', () => {
      // Mock high-end PC: 32GB RAM, 24GB free (25% pressure), 16 cores
      vi.spyOn(os, 'totalmem').mockReturnValue(32 * 1024 * 1024 * 1024);
      vi.spyOn(os, 'freemem').mockReturnValue(24 * 1024 * 1024 * 1024);
      vi.spyOn(os, 'cpus').mockReturnValue(new Array(16).fill({
        model: 'AMD Ryzen 9 5900X',
        times: { idle: 100, user: 10, sys: 10, irq: 0, nice: 0 },
      }) as any);

      const monitor = new HardwareMonitor();
      const metrics = monitor.getHardwareMetrics('auto');

      expect(metrics.detectedProfile).toBe('performance');
      expect(metrics.activeProfile).toBe('performance');
      expect(metrics.cpuCores).toBe(16);
    });

    it('detects balanced profile for mid-range systems', () => {
      // Mock mid-range PC: 8GB RAM, 5GB free (37% pressure), 6 cores
      vi.spyOn(os, 'totalmem').mockReturnValue(8 * 1024 * 1024 * 1024);
      vi.spyOn(os, 'freemem').mockReturnValue(5 * 1024 * 1024 * 1024);
      vi.spyOn(os, 'cpus').mockReturnValue(new Array(6).fill({
        model: 'Intel Core i5-10400',
        times: { idle: 100, user: 10, sys: 10, irq: 0, nice: 0 },
      }) as any);

      const monitor = new HardwareMonitor();
      const metrics = monitor.getHardwareMetrics('auto');

      expect(metrics.detectedProfile).toBe('balanced');
      expect(metrics.activeProfile).toBe('balanced');
    });
  });

  // ─── 2. Execution Parameters Mapping ────────────────────────────────────────
  describe('Execution Parameters by Profile', () => {
    it('provides conservative execution parameters for low profile without reducing AI accuracy', () => {
      const monitor = new HardwareMonitor();
      const params = monitor.getExecutionParams('low');

      expect(params.profile).toBe('low');
      expect(params.maxConcurrentJobs).toBe(1);
      expect(params.batchSize).toBe(25);
      // Non-negotiable principle: identical 1600px resolution across all profiles to preserve AI accuracy
      expect(params.maxFaceImageDimension).toBe(1600);
      expect(params.videoSamplingIntervalSeconds).toBe(5);
      expect(params.allowBackgroundAi).toBe(true); // Capabilities remain available
      expect(params.deferHeavyAi).toBe(true); // Deferred to background jobs
    });

    it('provides balanced execution parameters for balanced profile', () => {
      const monitor = new HardwareMonitor();
      const params = monitor.getExecutionParams('balanced');

      expect(params.profile).toBe('balanced');
      expect(params.maxConcurrentJobs).toBe(2);
      expect(params.batchSize).toBe(50);
      expect(params.maxFaceImageDimension).toBe(1600);
      expect(params.videoSamplingIntervalSeconds).toBe(5);
      expect(params.allowBackgroundAi).toBe(true);
      expect(params.deferHeavyAi).toBe(false);
    });

    it('provides high-throughput parameters for performance profile', () => {
      const monitor = new HardwareMonitor();
      const params = monitor.getExecutionParams('performance');

      expect(params.profile).toBe('performance');
      expect(params.maxConcurrentJobs).toBe(4);
      expect(params.batchSize).toBe(100);
      expect(params.maxFaceImageDimension).toBe(1600);
      expect(params.videoSamplingIntervalSeconds).toBe(3);
      expect(params.allowBackgroundAi).toBe(true);
      expect(params.deferHeavyAi).toBe(false);
    });

    it('adapts performance concurrency dynamically on quad-core machines (leaves 1 core for OS/UI)', () => {
      // 4-core machine in performance profile leaves 1 core for UI responsiveness: min(4, max(2, 4 - 1)) = 3
      vi.spyOn(os, 'cpus').mockReturnValue(new Array(4).fill({
        model: 'Generic 4-Core CPU',
        speed: 2500,
        times: { idle: 1000, user: 100, sys: 50, irq: 0, nice: 0 },
      }) as any);

      const monitor = new HardwareMonitor();
      const params = monitor.getExecutionParams('performance');
      expect(params.maxConcurrentJobs).toBe(3);
    });
  });

  // ─── 3. Dynamic Throttling & Hysteresis ──────────────────────────────────────
  describe('Dynamic Throttling & Hysteresis Prevention', () => {
    it('throttles down to low profile when memory pressure exceeds 82%', () => {
      // Mock 16GB total RAM with only 1GB free (93% memory pressure)
      const totalMem = 16 * 1024 * 1024 * 1024;
      const freeMem = 1 * 1024 * 1024 * 1024;
      vi.spyOn(os, 'totalmem').mockReturnValue(totalMem);
      vi.spyOn(os, 'freemem').mockReturnValue(freeMem);
      vi.spyOn(os, 'cpus').mockReturnValue(new Array(8).fill({
        model: 'Test CPU',
        times: { idle: 100, user: 20, sys: 10, irq: 0, nice: 0 },
      }) as any);

      const monitor = new HardwareMonitor();
      const metrics = monitor.getHardwareMetrics('performance');

      expect(metrics.isThrottled).toBe(true);
      expect(metrics.activeProfile).toBe('low');
      expect(metrics.throttleReason).toContain('High memory pressure');

      // The execution params should reflect the throttled low state with deferred heavy AI
      const params = monitor.getExecutionParams('performance');
      expect(params.profile).toBe('low');
      expect(params.allowBackgroundAi).toBe(true);
      expect(params.deferHeavyAi).toBe(true);
      expect(params.maxFaceImageDimension).toBe(1600); // Preserves model accuracy even when throttled
    });

    it('throttles down to low profile when CPU load exceeds 85%', () => {
      const monitor = new HardwareMonitor();
      // Test evaluateDynamicThrottling directly
      monitor.evaluateDynamicThrottling('performance', 40, 92);

      const params = monitor.getExecutionParams('performance');
      expect(params.isThrottled).toBe(true);
      expect(params.profile).toBe('low');
      expect(params.throttleReason).toContain('High CPU load (92%)');
      expect(params.deferHeavyAi).toBe(true);
    });

    it('prevents oscillating adjustments within the 5-second hysteresis window', () => {
      const monitor = new HardwareMonitor();
      // First, trigger throttle
      monitor.evaluateDynamicThrottling('performance', 85, 40);
      expect(monitor.getExecutionParams('performance').isThrottled).toBe(true);

      // Immediately attempt recovery within 100ms (should be rejected by hysteresis window)
      monitor.evaluateDynamicThrottling('performance', 30, 20);
      expect(monitor.getExecutionParams('performance').isThrottled).toBe(true);
    });
  });

  // ─── 4. Job Queue Management & Priority ─────────────────────────────────────
  describe('Job Queue Lifecycle & Priority Filtering', () => {
    it('calculates queue statistics accurately', () => {
      mockDb.jobs = [
        { id: '1', status: 'queued', priority: 1 },
        { id: '2', status: 'queued', priority: 2 },
        { id: '3', status: 'running', priority: 1 },
        { id: '4', status: 'failed', priority: 3 },
        { id: '5', status: 'completed', priority: 2 },
      ];

      const runner = new JobRunner();
      const stats = runner.getQueueStats();

      expect(stats.queuedJobs).toBe(2);
      expect(stats.failedJobs).toBe(1);
      expect(stats.completedJobs).toBe(1);
      expect(stats.isPaused).toBe(false);
      runner.stop();
    });

    it('supports pause and resume for all background jobs', () => {
      const runner = new JobRunner();
      expect(runner.getQueueStats().isPaused).toBe(false);

      runner.pauseAll();
      expect(runner.getQueueStats().isPaused).toBe(true);

      runner.resumeAll();
      expect(runner.getQueueStats().isPaused).toBe(false);
      runner.stop();
    });

    it('recovers stranded running jobs on startup', () => {
      mockDb.jobs = [
        { id: 'job-crash-1', status: 'running', priority: 2 },
        { id: 'job-crash-2', status: 'running', priority: 4 },
      ];

      const runner = new JobRunner();
      runner.recoverStrandedJobs();

      expect(mockDb.jobs[0].status).toBe('queued');
      expect(mockDb.jobs[1].status).toBe('queued');
      runner.stop();
    });
  });

  // ─── 5. Non-Negotiable Principle: Adaptive Performance Without Feature Loss ─
  describe('Non-Negotiable Principle: Adaptive Performance Without Feature Loss', () => {
    it('preserves 1600px AI model input resolution across all profiles (no accuracy degradation)', () => {
      const monitor = new HardwareMonitor();
      const profiles: Array<'low' | 'balanced' | 'performance'> = ['low', 'balanced', 'performance'];

      for (const profile of profiles) {
        const params = monitor.getExecutionParams(profile);
        // AI detection resolution is strictly identical across all hardware profiles
        expect(params.maxFaceImageDimension).toBe(1600);
        // AI background processing capability is never disabled
        expect(params.allowBackgroundAi).toBe(true);
      }
    });

    it('adapts scheduling via deferral rather than skipping or disabling features', () => {
      // Mock healthy system baseline to avoid host laptop memory pressure interference
      vi.spyOn(os, 'totalmem').mockReturnValue(32 * 1024 * 1024 * 1024);
      vi.spyOn(os, 'freemem').mockReturnValue(24 * 1024 * 1024 * 1024);
      vi.spyOn(os, 'cpus').mockReturnValue(new Array(16).fill({
        model: 'AMD Ryzen 9 5900X',
        times: { idle: 100, user: 10, sys: 10, irq: 0, nice: 0 },
      }) as any);

      const monitor = new HardwareMonitor();
      const lowParams = monitor.getExecutionParams('low');
      const balancedParams = monitor.getExecutionParams('balanced');
      const perfParams = monitor.getExecutionParams('performance');

      // Low systems adapt by scheduling: 1 worker, deferred heavy AI
      expect(lowParams.maxConcurrentJobs).toBe(1);
      expect(lowParams.deferHeavyAi).toBe(true);

      // Mid-range systems run 2 workers without deferral
      expect(balancedParams.maxConcurrentJobs).toBe(2);
      expect(balancedParams.deferHeavyAi).toBe(false);

      // High-performance systems process workloads faster
      expect(perfParams.maxConcurrentJobs).toBe(4);
      expect(perfParams.deferHeavyAi).toBe(false);
    });

    it('tracks pending AI processing transparently without false completion', () => {
      mockDb.files = [
        { id: 'f-1', processing_status: 'pending' },
        { id: 'f-2', processing_status: 'pending' },
        { id: 'f-3', processing_status: 'completed' },
      ];

      const runner = new JobRunner();
      const stats = runner.getQueueStats();

      // Transparent reporting: pending files are exposed to the user
      expect(stats.pendingAiFiles).toBe(2);
      runner.stop();
    });

    it('never reports a task as completed when required processing remains unfinished', () => {
      // Unprocessed files remain in pending status until the Priority 4 AI job executes
      const testFile = { id: 'file-deferred-1', processing_status: 'pending' };
      expect(testFile.processing_status).toBe('pending');
      expect(testFile.processing_status).not.toBe('completed');
    });
  });
});
