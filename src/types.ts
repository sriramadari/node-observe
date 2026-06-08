/** Minimal logger contract. `console` satisfies it. */
export interface Logger {
  info(message: string): void;
  error(message: string | Error): void;
  warn?(message: string): void;
  debug?(message: string): void;
}

/** Summary statistics for a set of recorded durations (all in milliseconds). */
export interface HistogramSnapshot {
  count: number;
  /** Number of samples flagged as errors (e.g. HTTP 5xx, failed query). */
  errors: number;
  mean: number;
  min: number;
  max: number;
  p50: number;
  p95: number;
  p99: number;
}

/** Categories of alert this library can raise. */
export type AlertType =
  | "slow-request"
  | "slow-mongo"
  | "slow-redis"
  | "memory-leak"
  | "memory-high";

export interface Alert {
  type: AlertType;
  /** Stable key used for de-duplication / cooldown (e.g. the route or query). */
  key: string;
  message: string;
  value: number;
  threshold: number;
  /** ISO timestamp. */
  at: string;
}

export interface InsightsThresholds {
  /** Alert when a single request exceeds this many ms. Default: 1000. */
  requestMs?: number;
  /** Alert when a single Mongo operation exceeds this many ms. Default: 300. */
  mongoMs?: number;
  /** Alert when a single Redis command exceeds this many ms. Default: 100. */
  redisMs?: number;
  /** Alert when heap grows faster than this many MB/min (sustained). Default: 50. */
  heapGrowthMbPerMin?: number;
  /** Alert when heap-used exceeds this many MB. Default: disabled (0). */
  heapUsedMb?: number;
}

export interface InsightsOptions {
  /** Label included in snapshots and alerts. Default: "node-observe". */
  serviceName?: string;
  /** Slack incoming-webhook URL. When set, alerts are posted to Slack. */
  slackWebhook?: string;
  /** Per-metric thresholds for alerting. */
  thresholds?: InsightsThresholds;
  /** Ring-buffer size per metric (bounds memory; affects percentile accuracy). Default: 1024. */
  sampleSize?: number;
  /** Minimum ms between repeats of the same alert key. Default: 60000. */
  alertCooldownMs?: number;
  /** How often to sample memory, in ms. Default: 15000. */
  memorySampleIntervalMs?: number;
  /** Custom alert sink, called for every alert (in addition to Slack). */
  onAlert?: (alert: Alert) => void;
  /** Logger for internal errors. Default: console. */
  logger?: Logger;
  /**
   * Collapse high-cardinality URL paths (numeric / ObjectId segments → `:id`)
   * so routes group together. Default: true. Set false to keep raw paths.
   */
  normalizePaths?: boolean;
}

/** Full point-in-time view of everything node-observe is tracking. */
export interface InsightsSnapshot {
  service: string;
  /** Process uptime in seconds. */
  uptimeSec: number;
  http: Record<string, HistogramSnapshot>;
  mongo: Record<string, HistogramSnapshot>;
  redis: Record<string, HistogramSnapshot>;
  counters: Record<string, number>;
  memory: MemorySnapshot;
  generatedAt: string;
}

export interface MemorySnapshot {
  heapUsedMb: number;
  heapTotalMb: number;
  rssMb: number;
  externalMb: number;
  /** Estimated heap growth rate over the recent window, MB/min (negative = shrinking). */
  growthMbPerMin: number;
}
