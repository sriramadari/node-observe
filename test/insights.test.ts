import { describe, expect, it, vi } from "vitest";
import { Insights } from "../src/insights";
import type { Alert } from "../src/types";

const silent = { info() {}, error() {}, warn() {}, debug() {} };

function flush() {
  return new Promise((r) => setImmediate(r));
}

describe("Insights recording + alerting", () => {
  it("records requests and increments status-class counters", () => {
    const i = new Insights({ logger: silent });
    i.recordRequest("get", "/users/12", 200, 42);
    i.recordRequest("GET", "/users/34", 500, 99);
    const snap = i.snapshot();
    expect(snap.http["GET /users/:id"]?.count).toBe(2);
    expect(snap.http["GET /users/:id"]?.errors).toBe(1); // the 500
    expect(snap.counters["http.status.2xx"]).toBe(1);
    expect(snap.counters["http.status.5xx"]).toBe(1);
  });

  it("respects normalizePaths: false", () => {
    const i = new Insights({ logger: silent, normalizePaths: false });
    i.recordRequest("GET", "/users/12", 200, 5);
    expect(i.snapshot().http["GET /users/12"]).toBeDefined();
  });

  it("raises a slow-request alert above the threshold", () => {
    const alerts: Alert[] = [];
    const i = new Insights({ logger: silent, thresholds: { requestMs: 100 }, onAlert: (a) => alerts.push(a) });
    i.recordRequest("GET", "/slow", 200, 250);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.type).toBe("slow-request");
    expect(alerts[0]?.value).toBe(250);
  });

  it("de-duplicates alerts within the cooldown window", () => {
    const alerts: Alert[] = [];
    const i = new Insights({ logger: silent, thresholds: { mongoMs: 10 }, alertCooldownMs: 60_000, onAlert: (a) => alerts.push(a) });
    i.recordMongo("User.find", 50);
    i.recordMongo("User.find", 60); // same key, suppressed
    i.recordMongo("Post.find", 50); // different key, allowed
    expect(alerts.map((a) => a.key)).toEqual(["User.find", "Post.find"]);
  });

  it("checkMemory raises a leak alert on sustained growth", () => {
    const alerts: Alert[] = [];
    const i = new Insights({
      logger: silent,
      thresholds: { heapGrowthMbPerMin: 5 },
      onAlert: (a) => alerts.push(a),
    });
    // Feed rising heap readings 1 minute apart: +20 MB/min, well above the 5 threshold.
    const MB = 1024 * 1024;
    for (let k = 0; k < 6; k++) {
      const mem = { heapUsed: (100 + k * 20) * MB, heapTotal: 0, rss: 0, external: 0, arrayBuffers: 0 } as NodeJS.MemoryUsage;
      i.checkMemory(k * 60_000, mem);
    }
    expect(alerts.some((a) => a.type === "memory-leak")).toBe(true);
  });
});

describe("Insights instrumentation", () => {
  it("express middleware times a request on finish", () => {
    const i = new Insights({ logger: silent });
    const mw = i.express();
    let finishCb: (() => void) | undefined;
    const req = { method: "GET", route: { path: "/things/:id" }, baseUrl: "" };
    const res = {
      statusCode: 200,
      on(ev: string, cb: () => void) {
        if (ev === "finish") finishCb = cb;
      },
    };
    let nexted = false;
    mw(req as any, res as any, () => (nexted = true));
    expect(nexted).toBe(true);
    finishCb?.();
    expect(i.snapshot().http["GET /things/:id"]?.count).toBe(1);
  });

  it("instrumentRedis times commands via the command promise", async () => {
    const i = new Insights({ logger: silent });
    const client: any = { sendCommand: (cmd: any) => cmd.promise };
    i.instrumentRedis(client);
    const cmd = { name: "GET", promise: Promise.resolve("v") };
    client.sendCommand(cmd);
    await cmd.promise;
    await flush();
    expect(i.snapshot().redis["get"]?.count).toBe(1);
  });

  it("instrumentRedis is idempotent", () => {
    const i = new Insights({ logger: silent });
    const original = (cmd: any) => cmd.promise;
    const client: any = { sendCommand: original };
    i.instrumentRedis(client);
    const afterFirst = client.sendCommand;
    i.instrumentRedis(client);
    expect(client.sendCommand).toBe(afterFirst); // not re-wrapped
  });

  it("instrumentMongoose registers hooks that record timings", () => {
    const i = new Insights({ logger: silent });
    const pres: Array<{ fn: (this: any) => void }> = [];
    const posts: Array<{ fn: (this: any) => void }> = [];
    const schema = {
      pre: (_h: unknown, fn: any) => pres.push({ fn }),
      post: (_h: unknown, fn: any) => posts.push({ fn }),
    };
    const mongoose = { plugin: (fn: any) => fn(schema) };
    i.instrumentMongoose(mongoose);

    // First registered pair is the query hook.
    const ctx = { model: { modelName: "User" }, op: "find" };
    pres[0]!.fn.call(ctx);
    posts[0]!.fn.call(ctx);
    expect(i.snapshot().mongo["User.find"]?.count).toBe(1);
  });

  it("warns and skips on non-mongoose / non-redis values", () => {
    const warn = vi.fn();
    const i = new Insights({ logger: { ...silent, warn } });
    i.instrumentMongoose({});
    i.instrumentRedis({});
    expect(warn).toHaveBeenCalledTimes(2);
  });
});

describe("Insights snapshot + handler", () => {
  it("handler responds with the snapshot via res.json", () => {
    const i = new Insights({ serviceName: "svc", logger: silent });
    let body: any;
    i.handler()({}, { json: (b: unknown) => (body = b) } as any);
    expect(body.service).toBe("svc");
    expect(body).toHaveProperty("http");
    expect(body).toHaveProperty("memory");
    expect(typeof body.uptimeSec).toBe("number");
  });
});
