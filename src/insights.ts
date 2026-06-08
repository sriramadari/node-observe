import { MetricsRegistry } from "./histogram";
import { MemoryMonitor } from "./memory";
import { postToSlack } from "./slack";
import { normalizePath } from "./util";
import { instrumentExpress } from "./express";
import { instrumentMongoose } from "./mongo";
import { instrumentRedis } from "./redis";
import type { Alert, AlertType, InsightsOptions, InsightsSnapshot, Logger } from "./types";

const consoleLogger: Logger = {
  info: (m) => console.log(m),
  error: (m) => console.error(m),
  warn: (m) => console.warn(m),
  debug: (m) => console.debug(m),
};

const DEFAULT_THRESHOLDS = {
  requestMs: 1000,
  mongoMs: 300,
  redisMs: 100,
  heapGrowthMbPerMin: 50,
  heapUsedMb: 0, // disabled by default
};

/**
 * The central observability handle. Create one per process, attach the
 * instrumentations you want, and read {@link Insights.snapshot} (or mount
 * {@link Insights.handler}) to see latency percentiles, query timings, memory
 * trend, and counters. Threshold breaches raise {@link Alert}s, optionally
 * pushed to Slack.
 *
 * @example
 * ```ts
 * const insights = new Insights({ serviceName: "api", slackWebhook: process.env.SLACK_URL });
 * app.use(insights.express());
 * insights.instrumentMongoose(mongoose);
 * insights.instrumentRedis(redis);
 * insights.startMemoryMonitor();
 * app.get("/insights", insights.handler());
 * ```
 */
export class Insights {
  readonly http: MetricsRegistry;
  readonly mongo: MetricsRegistry;
  readonly redis: MetricsRegistry;
  private readonly counters: MetricsRegistry;
  private readonly memory: MemoryMonitor;

  readonly serviceName: string;
  readonly thresholds: Required<NonNullable<InsightsOptions["thresholds"]>>;
  readonly logger: Logger;
  private readonly opts: InsightsOptions;
  private readonly cooldownMs: number;
  private readonly lastAlertAt = new Map<string, number>();
  private memoryTimer: ReturnType<typeof setInterval> | undefined;
  private readonly startedAt = Date.now();

  constructor(options: InsightsOptions = {}) {
    this.opts = options;
    this.serviceName = options.serviceName ?? "node-observe";
    this.thresholds = { ...DEFAULT_THRESHOLDS, ...(options.thresholds ?? {}) };
    this.logger = options.logger ?? consoleLogger;
    this.cooldownMs = options.alertCooldownMs ?? 60_000;
    this.memory = new MemoryMonitor();
    const cap = options.sampleSize ?? 1024;
    this.http = new MetricsRegistry(cap);
    this.mongo = new MetricsRegistry(cap);
    this.redis = new MetricsRegistry(cap);
    this.counters = new MetricsRegistry(cap);
  }

  // ---- recording (used by the instrumentations) -----------------------------

  /** Record an HTTP request. `route` is normalized when `normalizePaths` is on. */
  recordRequest(method: string, route: string, statusCode: number, ms: number): void {
    const path = this.opts.normalizePaths === false ? route : normalizePath(route);
    const isError = statusCode >= 500;
    const key = `${method.toUpperCase()} ${path}`;
    this.http.record(key, ms, isError);
    this.counters.increment(`http.status.${Math.floor(statusCode / 100)}xx`);
    if (ms > this.thresholds.requestMs) {
      this.raise("slow-request", key, `${key} took ${ms.toFixed(0)}ms`, ms, this.thresholds.requestMs);
    }
  }

  /** Record a Mongo operation, e.g. `User.find`. */
  recordMongo(operation: string, ms: number, isError = false): void {
    this.mongo.record(operation, ms, isError);
    if (ms > this.thresholds.mongoMs) {
      this.raise("slow-mongo", operation, `Mongo ${operation} took ${ms.toFixed(0)}ms`, ms, this.thresholds.mongoMs);
    }
  }

  /** Record a Redis command, e.g. `get`. */
  recordRedis(command: string, ms: number, isError = false): void {
    this.redis.record(command, ms, isError);
    if (ms > this.thresholds.redisMs) {
      this.raise("slow-redis", command, `Redis ${command} took ${ms.toFixed(0)}ms`, ms, this.thresholds.redisMs);
    }
  }

  // ---- instrumentation attach points ----------------------------------------

  /** Express/Connect middleware that times every request. */
  express() {
    return instrumentExpress(this);
  }

  /** Instrument a Mongoose instance so every query/aggregate/save is timed. */
  instrumentMongoose(mongoose: unknown): void {
    instrumentMongoose(mongoose, this);
  }

  /** Instrument an ioredis client so every command is timed. */
  instrumentRedis(client: unknown): void {
    instrumentRedis(client, this);
  }

  /** Begin periodic memory sampling + leak detection. Returns a stop function. */
  startMemoryMonitor(): () => void {
    if (this.memoryTimer) return () => this.stopMemoryMonitor();
    const interval = this.opts.memorySampleIntervalMs ?? 15_000;
    this.memoryTimer = setInterval(() => this.checkMemory(), interval);
    // Don't keep the event loop alive just for monitoring.
    this.memoryTimer.unref?.();
    return () => this.stopMemoryMonitor();
  }

  stopMemoryMonitor(): void {
    if (this.memoryTimer) {
      clearInterval(this.memoryTimer);
      this.memoryTimer = undefined;
    }
  }

  /**
   * Take one memory reading and evaluate the leak/high-heap thresholds.
   * `now`/`mem` are injectable for testing; both default to live process values.
   */
  checkMemory(now: number = Date.now(), mem: NodeJS.MemoryUsage = process.memoryUsage()): void {
    this.memory.sample(now, mem);
    const snap = this.memory.snapshot(mem);

    if (
      this.memory.size >= 5 &&
      snap.growthMbPerMin > this.thresholds.heapGrowthMbPerMin
    ) {
      this.raise(
        "memory-leak",
        "heap",
        `Heap growing ${snap.growthMbPerMin}MB/min (now ${snap.heapUsedMb}MB)`,
        snap.growthMbPerMin,
        this.thresholds.heapGrowthMbPerMin,
      );
    }
    if (this.thresholds.heapUsedMb > 0 && snap.heapUsedMb > this.thresholds.heapUsedMb) {
      this.raise(
        "memory-high",
        "heap",
        `Heap usage ${snap.heapUsedMb}MB`,
        snap.heapUsedMb,
        this.thresholds.heapUsedMb,
      );
    }
  }

  // ---- output ---------------------------------------------------------------

  snapshot(): InsightsSnapshot {
    const mem = process.memoryUsage();
    return {
      service: this.serviceName,
      uptimeSec: Math.round((Date.now() - this.startedAt) / 1000),
      http: this.http.snapshot(),
      mongo: this.mongo.snapshot(),
      redis: this.redis.snapshot(),
      counters: this.counters.counterSnapshot(),
      memory: this.memory.snapshot(mem),
      generatedAt: new Date().toISOString(),
    };
  }

  /** Express handler that responds with the JSON snapshot. */
  handler() {
    return (_req: unknown, res: { json?: (b: unknown) => void; setHeader?: (k: string, v: string) => void; end?: (s: string) => void }) => {
      const body = this.snapshot();
      if (typeof res.json === "function") {
        res.json(body);
      } else {
        res.setHeader?.("Content-Type", "application/json");
        res.end?.(JSON.stringify(body));
      }
    };
  }

  // ---- alerting -------------------------------------------------------------

  private raise(type: AlertType, key: string, message: string, value: number, threshold: number): void {
    const dedupeKey = `${type}:${key}`;
    const now = Date.now();
    const last = this.lastAlertAt.get(dedupeKey) ?? 0;
    if (now - last < this.cooldownMs) return; // within cooldown — suppress
    this.lastAlertAt.set(dedupeKey, now);

    const alert: Alert = {
      type,
      key,
      message,
      value: Math.round(value * 100) / 100,
      threshold,
      at: new Date(now).toISOString(),
    };

    try {
      this.opts.onAlert?.(alert);
    } catch (err) {
      this.logger.error(`node-observe: onAlert handler threw: ${(err as Error).message}`);
    }
    if (this.opts.slackWebhook) {
      void postToSlack(this.opts.slackWebhook, alert, this.serviceName, this.logger);
    }
  }
}
