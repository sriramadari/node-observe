# node-observe

**Datadog-lite backend observability for Node.js.** No agent, no SaaS bill, minimal dependencies — drop it into an Express + Mongo + Redis app and get latency percentiles, query timings, memory-leak detection, and Slack alerts in a few lines.

Built for small teams who don't (yet) have an APM but still need to know *what's slow* and *when something's leaking*.

- 🌐 **API latency tracking** — per-route p50/p95/p99, error rates, status-class counters
- 🍃 **MongoDB query timing** — every Mongoose query/aggregate/save, by `Model.op`
- 🧱 **Redis timing** — every ioredis command, by command name
- 📈 **Memory-leak detection** — least-squares trend on heap-used (MB/min), not noisy single readings
- 🔔 **Slack alerts** — threshold breaches pushed to a webhook, with cooldown de-duplication
- 📊 **`/insights` snapshot** — one JSON endpoint with everything

```bash
npm install node-observe
```

> Node ≥ 18 (uses global `fetch` for Slack). ESM + CJS, fully typed. `express`, `mongoose`, and `ioredis` are **optional** — node-observe duck-types whatever you pass it, so it depends on none of them.

---

## Quick start

```ts
import express from "express";
import mongoose from "mongoose";
import Redis from "ioredis";
import { Insights } from "node-observe";

const insights = new Insights({
  serviceName: "api",
  slackWebhook: process.env.SLACK_WEBHOOK_URL, // optional
  thresholds: {
    requestMs: 1000,   // alert on requests slower than 1s
    mongoMs: 300,
    redisMs: 100,
    heapGrowthMbPerMin: 50,
  },
});

const app = express();

app.use(insights.express());          // 1. time every request
insights.instrumentMongoose(mongoose); // 2. time every Mongo op (call before models compile)
insights.instrumentRedis(new Redis()); // 3. time every Redis command
insights.startMemoryMonitor();         // 4. watch the heap for leaks

app.get("/insights", insights.handler()); // 5. expose the JSON snapshot
```

That's it. Hit `/insights` and you'll see something like:

```jsonc
{
  "service": "api",
  "uptimeSec": 3600,
  "http": {
    "GET /users/:id":  { "count": 1240, "errors": 3, "mean": 42.1, "p95": 88.0, "p99": 210.5, ... },
    "POST /posts":     { "count": 95,  "errors": 0, "mean": 120.4, "p95": 305.0, ... }
  },
  "mongo": { "User.findOne": { "count": 2100, "p95": 12.0, ... }, "Post.aggregate": { "p95": 240.0, ... } },
  "redis": { "get": { "count": 8800, "p95": 1.2 }, "hgetall": { "p95": 3.0 } },
  "counters": { "http.status.2xx": 1300, "http.status.5xx": 3 },
  "memory": { "heapUsedMb": 180.2, "rssMb": 320.5, "growthMbPerMin": 1.4 }
}
```

---

## Alerts

When a metric crosses its threshold, node-observe raises an `Alert`. Each alert is de-duplicated per key for `alertCooldownMs` (default 60s) so you don't get spammed.

```ts
const insights = new Insights({
  slackWebhook: process.env.SLACK_WEBHOOK_URL,
  onAlert: (alert) => {
    // also forward anywhere you like: logs, PagerDuty, etc.
    logger.warn(`[${alert.type}] ${alert.message}`);
  },
});
```

Alert types: `slow-request`, `slow-mongo`, `slow-redis`, `memory-leak`, `memory-high`.

A Slack alert looks like:

> 🐢 **[api] slow-request**
> `GET /users/:id` took 1820ms
> • value: `1820` • threshold: `1000` • at: 2026-06-08T12:00:00.000Z

### Memory-leak detection

`startMemoryMonitor()` samples `heapUsed` every `memorySampleIntervalMs` (default 15s) and fits a least-squares line over the recent window. A **sustained** positive slope (MB/min) above `heapGrowthMbPerMin` triggers `memory-leak` — this ignores the sawtooth of normal GC, which single-threshold checks get wrong. Set `heapUsedMb` to also alert on an absolute heap ceiling.

---

## Configuration

| Option | Default | Description |
| --- | --- | --- |
| `serviceName` | `"node-observe"` | Label in snapshots/alerts. |
| `slackWebhook` | — | Slack incoming-webhook URL. |
| `thresholds.requestMs` | `1000` | Slow-request alert threshold. |
| `thresholds.mongoMs` | `300` | Slow-Mongo alert threshold. |
| `thresholds.redisMs` | `100` | Slow-Redis alert threshold. |
| `thresholds.heapGrowthMbPerMin` | `50` | Leak alert threshold. |
| `thresholds.heapUsedMb` | `0` (off) | Absolute heap alert. |
| `sampleSize` | `1024` | Ring-buffer size per metric (percentile window). |
| `alertCooldownMs` | `60000` | Min gap between repeats of the same alert. |
| `memorySampleIntervalMs` | `15000` | Memory sampling cadence. |
| `normalizePaths` | `true` | Collapse `/users/123` → `/users/:id`. |
| `onAlert` | — | Custom alert sink. |
| `memoryUsage` | `process.memoryUsage` | Source of heap readings. Inject one for deterministic tests or runtimes without `process`. |
| `logger` | `console` | Internal error logger. |

---

## API

| Export | Description |
| --- | --- |
| `new Insights(options)` | The central handle. |
| `insights.express()` | Express/Connect middleware (request latency). |
| `insights.instrumentMongoose(mongoose)` | Global plugin timing all queries. |
| `insights.instrumentRedis(client)` | Wrap an ioredis client's commands. |
| `insights.startMemoryMonitor()` | Start leak detection (returns a stop fn). |
| `insights.snapshot()` | Current `InsightsSnapshot` object. |
| `insights.handler()` | Express handler serving the snapshot as JSON. |
| `insights.recordRequest/recordMongo/recordRedis(...)` | Manual recording. |
| `Histogram`, `MetricsRegistry`, `MemoryMonitor` | Building blocks, exported for custom use. |
| `normalizePath`, `formatSlackMessage`, `postToSlack` | Utilities. |

## Notes

- The Express middleware records on the response `finish`/`close` event and prefers the matched route pattern (`req.route.path`) to keep cardinality low.
- `instrumentMongoose` must run **before** your models are compiled so the global plugin applies to every schema.
- `instrumentRedis` is idempotent — calling it twice on the same client is a no-op.
- Observability never throws into your app: Slack failures and `onAlert` errors are logged, not propagated.
- All durations are milliseconds; memory values are MB.

## License

MIT
