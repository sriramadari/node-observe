import { describe, expect, it } from "vitest";
import { MemoryMonitor } from "../src/memory";

const MB = 1024 * 1024;
function mem(heapUsedMb: number): NodeJS.MemoryUsage {
  return { heapUsed: heapUsedMb * MB, heapTotal: 0, rss: 0, external: 0, arrayBuffers: 0 } as NodeJS.MemoryUsage;
}

describe("MemoryMonitor", () => {
  it("reports ~0 growth for a flat heap", () => {
    const m = new MemoryMonitor();
    for (let i = 0; i < 10; i++) m.sample(i * 60_000, mem(100));
    expect(m.growthMbPerMin()).toBeCloseTo(0, 5);
  });

  it("detects a steady upward leak (MB/min slope)", () => {
    const m = new MemoryMonitor();
    // +10 MB each minute
    for (let i = 0; i < 10; i++) m.sample(i * 60_000, mem(100 + i * 10));
    expect(m.growthMbPerMin()).toBeCloseTo(10, 1);
  });

  it("reports negative growth when heap shrinks", () => {
    const m = new MemoryMonitor();
    for (let i = 0; i < 6; i++) m.sample(i * 60_000, mem(200 - i * 5));
    expect(m.growthMbPerMin()).toBeLessThan(0);
  });

  it("keeps only the most recent window of samples", () => {
    const m = new MemoryMonitor(5);
    for (let i = 0; i < 50; i++) m.sample(i * 1000, mem(100));
    expect(m.size).toBe(5);
  });

  it("snapshots converted MB values", () => {
    const m = new MemoryMonitor();
    const s = m.snapshot(mem(123));
    expect(s.heapUsedMb).toBe(123);
  });
});
