import type { MemorySnapshot, MemoryUsage } from "./types";

interface Sample {
  t: number; // ms timestamp
  heapUsed: number; // bytes
}

/**
 * Tracks heap-used over time and estimates the growth trend via least-squares
 * linear regression. A sustained positive slope is the signal of a memory leak —
 * far more reliable than reacting to a single high reading (which is usually
 * just GC timing).
 */
export class MemoryMonitor {
  private readonly samples: Sample[] = [];
  private readonly window: number;

  constructor(window = 30) {
    this.window = Math.max(2, window);
  }

  /** Add the current memory reading. `now`/`mem` are injectable for testing. */
  sample(now: number, mem: MemoryUsage): void {
    this.samples.push({ t: now, heapUsed: mem.heapUsed });
    if (this.samples.length > this.window) this.samples.shift();
  }

  /** Heap growth rate in MB per minute over the retained window. */
  growthMbPerMin(): number {
    if (this.samples.length < 2) return 0;
    const n = this.samples.length;
    const t0 = this.samples[0]!.t;
    let sx = 0;
    let sy = 0;
    let sxx = 0;
    let sxy = 0;
    for (const s of this.samples) {
      const x = (s.t - t0) / 60000; // minutes since window start
      const y = s.heapUsed / (1024 * 1024); // MB
      sx += x;
      sy += y;
      sxx += x * x;
      sxy += x * y;
    }
    const denom = n * sxx - sx * sx;
    if (denom === 0) return 0;
    const slope = (n * sxy - sx * sy) / denom; // MB per minute
    return Math.round(slope * 100) / 100;
  }

  snapshot(mem: MemoryUsage): MemorySnapshot {
    const mb = (b: number) => Math.round((b / (1024 * 1024)) * 100) / 100;
    return {
      heapUsedMb: mb(mem.heapUsed),
      heapTotalMb: mb(mem.heapTotal),
      rssMb: mb(mem.rss),
      externalMb: mb(mem.external),
      growthMbPerMin: this.growthMbPerMin(),
    };
  }

  /** Number of samples currently retained. */
  get size(): number {
    return this.samples.length;
  }
}
