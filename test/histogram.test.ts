import { describe, expect, it } from "vitest";
import { Histogram, MetricsRegistry } from "../src/histogram";

describe("Histogram", () => {
  it("computes count, mean, min, max", () => {
    const h = new Histogram();
    [10, 20, 30].forEach((v) => h.record(v));
    const s = h.snapshot();
    expect(s.count).toBe(3);
    expect(s.mean).toBe(20);
    expect(s.min).toBe(10);
    expect(s.max).toBe(30);
  });

  it("computes percentiles via interpolation", () => {
    const h = new Histogram();
    for (let i = 1; i <= 100; i++) h.record(i);
    const s = h.snapshot();
    expect(s.p50).toBeCloseTo(50.5, 1);
    expect(s.p95).toBeCloseTo(95.05, 1);
    expect(s.p99).toBeCloseTo(99.01, 1);
  });

  it("tracks errors separately", () => {
    const h = new Histogram();
    h.record(5, false);
    h.record(5, true);
    expect(h.snapshot().errors).toBe(1);
    expect(h.snapshot().count).toBe(2);
  });

  it("bounds memory with a ring buffer but keeps lifetime count/max", () => {
    const h = new Histogram(10);
    for (let i = 1; i <= 1000; i++) h.record(i);
    const s = h.snapshot();
    expect(s.count).toBe(1000); // lifetime
    expect(s.max).toBe(1000); // lifetime max retained
    // percentiles only see the last 10 samples (991..1000)
    expect(s.p50).toBeGreaterThan(990);
  });

  it("ignores invalid samples", () => {
    const h = new Histogram();
    h.record(-1);
    h.record(NaN);
    h.record(Infinity);
    expect(h.snapshot().count).toBe(0);
  });
});

describe("MetricsRegistry", () => {
  it("records into named histograms and counters", () => {
    const r = new MetricsRegistry();
    r.record("GET /a", 10);
    r.record("GET /a", 20);
    r.record("GET /b", 5);
    r.increment("hits", 3);
    const snap = r.snapshot();
    expect(snap["GET /a"]?.count).toBe(2);
    expect(snap["GET /b"]?.count).toBe(1);
    expect(r.counterSnapshot().hits).toBe(3);
  });
});
