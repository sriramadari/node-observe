import type { HistogramSnapshot } from "./types";

/**
 * A bounded latency histogram. Keeps the most recent `cap` samples in a ring
 * buffer (so memory is constant) while tracking lifetime count/min/max/sum and
 * an error tally. Percentiles are computed over the retained window.
 */
export class Histogram {
  private readonly buffer: number[] = [];
  private head = 0;
  private readonly cap: number;

  count = 0;
  errors = 0;
  private sum = 0;
  private minV = Infinity;
  private maxV = -Infinity;

  constructor(cap = 1024) {
    this.cap = Math.max(1, cap);
  }

  /** Record one duration (ms). Mark `isError` to count it toward the error tally. */
  record(value: number, isError = false): void {
    if (!Number.isFinite(value) || value < 0) return;
    this.count++;
    this.sum += value;
    if (isError) this.errors++;
    if (value < this.minV) this.minV = value;
    if (value > this.maxV) this.maxV = value;

    if (this.buffer.length < this.cap) {
      this.buffer.push(value);
    } else {
      this.buffer[this.head] = value;
      this.head = (this.head + 1) % this.cap;
    }
  }

  /** Linear-interpolation percentile over the retained window. `p` in [0,100]. */
  percentile(p: number): number {
    const n = this.buffer.length;
    if (n === 0) return 0;
    const sorted = [...this.buffer].sort((a, b) => a - b);
    if (n === 1) return sorted[0] as number;
    const rank = (p / 100) * (n - 1);
    const lo = Math.floor(rank);
    const hi = Math.ceil(rank);
    const frac = rank - lo;
    return (sorted[lo] as number) * (1 - frac) + (sorted[hi] as number) * frac;
  }

  snapshot(): HistogramSnapshot {
    const round = (n: number) => Math.round(n * 100) / 100;
    return {
      count: this.count,
      errors: this.errors,
      mean: this.count ? round(this.sum / this.count) : 0,
      min: this.count ? round(this.minV) : 0,
      max: this.count ? round(this.maxV) : 0,
      p50: round(this.percentile(50)),
      p95: round(this.percentile(95)),
      p99: round(this.percentile(99)),
    };
  }
}

/** A named set of histograms plus simple counters. */
export class MetricsRegistry {
  private readonly histograms = new Map<string, Histogram>();
  private readonly counters = new Map<string, number>();

  constructor(private readonly cap = 1024) {}

  record(name: string, value: number, isError = false): void {
    let h = this.histograms.get(name);
    if (!h) {
      h = new Histogram(this.cap);
      this.histograms.set(name, h);
    }
    h.record(value, isError);
  }

  increment(name: string, by = 1): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + by);
  }

  snapshot(): Record<string, HistogramSnapshot> {
    const out: Record<string, HistogramSnapshot> = {};
    for (const [name, h] of this.histograms) out[name] = h.snapshot();
    return out;
  }

  counterSnapshot(): Record<string, number> {
    return Object.fromEntries(this.counters);
  }

  reset(): void {
    this.histograms.clear();
    this.counters.clear();
  }
}
