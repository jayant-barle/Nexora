// ============================================================================
// Nexora — Hardware Monitor & Adaptive Resource Management Service
// Real-time hardware telemetry, dynamic profile adaptation, and hysteresis controls
// ============================================================================

import os from 'os';
import { execSync } from 'child_process';
import type { HardwareMetrics, ResourceProfile } from '../shared/types';
import { getDb } from './database';

export interface ProfileExecutionParams {
  profile: 'low' | 'balanced' | 'performance';
  maxConcurrentJobs: number;
  batchSize: number;
  maxFaceImageDimension: number;
  videoSamplingIntervalSeconds: number;
  allowBackgroundAi: boolean;
  deferHeavyAi: boolean;
  isThrottled: boolean;
  throttleReason?: string;
}

export class HardwareMonitor {
  private lastCpuSample: { idle: number; total: number } | null = null;
  private cachedGpuInfo: { name: string | null; vramBytes: number | null; provider: 'DirectML' | 'CUDA' | 'OpenCL' | 'CPU'; available: boolean } | null = null;
  private cachedDiskType: 'SSD' | 'HDD' | 'Unknown' = 'Unknown';
  private detectedBaselineProfile: 'low' | 'balanced' | 'performance' = 'balanced';
  
  // Hysteresis state
  private activeAdaptiveProfile: 'low' | 'balanced' | 'performance' = 'balanced';
  private lastProfileAdjustmentTime = 0;
  private readonly ADJUSTMENT_INTERVAL_MS = 5000; // Minimum 5s hysteresis window
  private isThrottled = false;
  private throttleReason: string | null = null;

  constructor() {
    this.detectHardwareBaseline();
  }

  // ─── Hardware Baseline Detection ───────────────────────────────────────────

  public detectHardwareBaseline(): void {
    const totalMem = os.totalmem();
    const cores = os.cpus().length;

    // Detect initial profile based on installed physical resources
    // Low-end: <= 6GB RAM or <= 4 CPU cores
    // High-end: >= 16GB RAM and >= 8 CPU cores
    if (totalMem <= 6 * 1024 * 1024 * 1024 || cores <= 4) {
      this.detectedBaselineProfile = 'low';
    } else if (totalMem >= 16 * 1024 * 1024 * 1024 && cores >= 8) {
      this.detectedBaselineProfile = 'performance';
    } else {
      this.detectedBaselineProfile = 'balanced';
    }

    this.activeAdaptiveProfile = this.detectedBaselineProfile;

    // Probe GPU without admin privileges
    this.probeGpuInfo();
    // Probe primary disk type without admin privileges
    this.probeDiskType();
  }

  private probeGpuInfo(): void {
    try {
      if (process.platform === 'win32') {
        // Modern Windows 11 standard non-admin probe via PowerShell Get-CimInstance
        const psCommand = 'powershell -NoProfile -NonInteractive -Command "Get-CimInstance Win32_VideoController | Select-Object -Property Caption,AdapterRAM | ConvertTo-Csv -NoTypeInformation"';
        let output = '';
        try {
          output = execSync(psCommand, { encoding: 'utf-8', timeout: 3500, stdio: ['ignore', 'pipe', 'ignore'] });
        } catch {
          // Fallback to WMIC if PowerShell execution is restricted
          output = execSync('wmic path win32_VideoController get caption,adapterram /format:csv', {
            encoding: 'utf-8',
            timeout: 3000,
            stdio: ['ignore', 'pipe', 'ignore'],
          });
        }

        const lines = output.trim().split('\n').map(l => l.replace(/\r$/, '')).filter(l => l.trim().length > 0);
        for (let i = 1; i < lines.length; i++) {
          const parts = lines[i].split(',').map(p => p.replace(/^"|"$/g, '').trim());
          if (parts.length >= 2) {
            // Check Caption and AdapterRAM columns
            const name = parts[0] && isNaN(Number(parts[0])) ? parts[0] : parts[1];
            const vramStr = parts[1] && !isNaN(Number(parts[1])) ? parts[1] : parts[0];
            const vram = parseInt(vramStr || '0', 10);

            if (name && !name.toLowerCase().includes('remote') && !name.toLowerCase().includes('basic render')) {
              let provider: 'DirectML' | 'CUDA' | 'OpenCL' | 'CPU' = 'DirectML';
              if (name.toLowerCase().includes('nvidia')) {
                provider = 'CUDA';
              } else if (name.toLowerCase().includes('amd') || name.toLowerCase().includes('radeon') || name.toLowerCase().includes('intel')) {
                provider = 'DirectML';
              }

              this.cachedGpuInfo = {
                name,
                vramBytes: vram > 0 ? vram : null,
                provider,
                available: true,
              };
              return;
            }
          }
        }
      }
    } catch {
      // Fallback silently if non-privileged shell is restricted
    }

    this.cachedGpuInfo = {
      name: null,
      vramBytes: null,
      provider: 'CPU',
      available: false,
    };
  }

  private probeDiskType(): void {
    try {
      if (process.platform === 'win32') {
        // Fast, non-admin probe via PowerShell
        const out = execSync(
          'powershell -NoProfile -NonInteractive -Command "Get-PhysicalDisk | Select-Object -First 1 -ExpandProperty MediaType"',
          { encoding: 'utf-8', timeout: 3500, stdio: ['ignore', 'pipe', 'ignore'] }
        ).trim().toUpperCase();

        if (out.includes('SSD')) {
          this.cachedDiskType = 'SSD';
          return;
        } else if (out.includes('HDD')) {
          this.cachedDiskType = 'HDD';
          return;
        }
      }
    } catch {}
    this.cachedDiskType = 'Unknown';
  }

  // ─── Real-Time CPU Load Sampling ───────────────────────────────────────────

  public getCpuLoadPercent(): number {
    const cpus = os.cpus();
    let idle = 0;
    let total = 0;

    for (const cpu of cpus) {
      idle += cpu.times.idle;
      total += cpu.times.idle + cpu.times.user + cpu.times.sys + cpu.times.irq + cpu.times.nice;
    }

    if (!this.lastCpuSample) {
      this.lastCpuSample = { idle, total };
      return 0;
    }

    const idleDelta = idle - this.lastCpuSample.idle;
    const totalDelta = total - this.lastCpuSample.total;
    this.lastCpuSample = { idle, total };

    if (totalDelta <= 0) return 0;
    const load = 100 - (idleDelta / totalDelta) * 100;
    return Math.min(100, Math.max(0, Math.round(load)));
  }

  // ─── Active Hardware Telemetry ─────────────────────────────────────────────

  public getMetrics(configuredProfile: ResourceProfile = 'auto'): HardwareMetrics {
    return this.getHardwareMetrics(configuredProfile);
  }

  public getHardwareMetrics(configuredProfile: ResourceProfile = 'auto'): HardwareMetrics {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const memoryPressurePercent = Math.round(((totalMem - freeMem) / totalMem) * 100);
    const cpuLoadPercent = this.getCpuLoadPercent();

    let activeJobCount = 0;
    try {
      const db = getDb();
      const row = db.prepare("SELECT COUNT(*) as count FROM jobs WHERE status = 'running'").get() as any;
      activeJobCount = row?.count || 0;
    } catch {}

    // Evaluate dynamic adaptation with hysteresis
    this.evaluateDynamicThrottling(configuredProfile, memoryPressurePercent, cpuLoadPercent);

    return {
      totalMemoryBytes: totalMem,
      freeMemoryBytes: freeMem,
      usedMemoryBytes: usedMem,
      memoryPressurePercent,
      cpuCores: os.cpus().length,
      cpuModel: os.cpus()[0]?.model?.trim() || 'Generic CPU',
      cpuLoadPercent,
      gpuName: this.cachedGpuInfo?.name || null,
      gpuVramBytes: this.cachedGpuInfo?.vramBytes || null,
      accelerationProvider: this.cachedGpuInfo?.provider || 'CPU',
      isGpuAvailable: this.cachedGpuInfo?.available || false,
      primaryDiskType: this.cachedDiskType,
      activeJobCount,
      detectedProfile: this.detectedBaselineProfile,
      activeProfile: this.activeAdaptiveProfile,
      isThrottled: this.isThrottled,
      throttleReason: this.throttleReason,
    };
  }

  // ─── Dynamic Throttling & Hysteresis ───────────────────────────────────────

  public evaluateDynamicThrottling(
    configuredProfile: ResourceProfile,
    memoryPressurePercent: number,
    cpuLoadPercent: number
  ): void {
    const now = Date.now();
    const baseProfile = configuredProfile === 'auto' ? this.detectedBaselineProfile : configuredProfile;

    // Check throttle conditions
    // Memory pressure > 82% OR CPU sustained load > 85% triggers throttling down to low
    const shouldThrottle = memoryPressurePercent > 82 || cpuLoadPercent > 85;
    // Recovery condition requires memory pressure < 70% AND CPU load < 70%
    const shouldRecover = memoryPressurePercent < 70 && cpuLoadPercent < 70;

    if (now - this.lastProfileAdjustmentTime < this.ADJUSTMENT_INTERVAL_MS) {
      // Within hysteresis hold window; do not oscillate
      return;
    }

    if (shouldThrottle && !this.isThrottled) {
      this.isThrottled = true;
      this.activeAdaptiveProfile = 'low';
      this.throttleReason = memoryPressurePercent > 82
        ? `High memory pressure (${memoryPressurePercent}%)`
        : `High CPU load (${cpuLoadPercent}%)`;
      this.lastProfileAdjustmentTime = now;
    } else if (shouldRecover && this.isThrottled) {
      this.isThrottled = false;
      this.activeAdaptiveProfile = baseProfile;
      this.throttleReason = null;
      this.lastProfileAdjustmentTime = now;
    } else if (!this.isThrottled) {
      this.activeAdaptiveProfile = baseProfile;
    }
  }

  // ─── Resolve Effective Execution Parameters ────────────────────────────────

  public getExecutionParams(configuredProfile: ResourceProfile = 'auto'): ProfileExecutionParams {
    const metrics = this.getHardwareMetrics(configuredProfile);
    const effectiveProfile = metrics.activeProfile;

    switch (effectiveProfile) {
      case 'low':
        return {
          profile: 'low',
          maxConcurrentJobs: 1,
          batchSize: 25,
          maxFaceImageDimension: 1600,
          videoSamplingIntervalSeconds: 5,
          allowBackgroundAi: true,
          deferHeavyAi: true, // Defer heavy face/video processing to background queue so analysis is never lost
          isThrottled: metrics.isThrottled,
          throttleReason: metrics.throttleReason || undefined,
        };

      case 'performance':
        const cores = metrics.cpuCores;
        return {
          profile: 'performance',
          maxConcurrentJobs: Math.min(4, Math.max(2, cores - 1)),
          batchSize: 100,
          maxFaceImageDimension: 1600,
          videoSamplingIntervalSeconds: 3,
          allowBackgroundAi: true,
          deferHeavyAi: false,
          isThrottled: false,
        };

      case 'balanced':
      default:
        return {
          profile: 'balanced',
          maxConcurrentJobs: 2,
          batchSize: 50,
          maxFaceImageDimension: 1600,
          videoSamplingIntervalSeconds: 5,
          allowBackgroundAi: true,
          deferHeavyAi: metrics.isThrottled,
          isThrottled: metrics.isThrottled,
          throttleReason: metrics.throttleReason || undefined,
        };
    }
  }
}

// Singleton HardwareMonitor instance
let _hardwareMonitor: HardwareMonitor | null = null;

export function getHardwareMonitor(): HardwareMonitor {
  if (!_hardwareMonitor) {
    _hardwareMonitor = new HardwareMonitor();
  }
  return _hardwareMonitor;
}
