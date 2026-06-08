# Changelog

All notable changes to this project are documented here. This project adheres to
[Semantic Versioning](https://semver.org/).

## 0.1.0

Initial release.

- **API latency** — Express/Connect middleware with per-route p50/p95/p99, error
  rates, and status-class counters; low-cardinality path normalization.
- **MongoDB timing** — `instrumentMongoose` global plugin timing every
  query/aggregate/save as `Model.op`.
- **Redis timing** — `instrumentRedis` wraps ioredis `sendCommand` per command
  (idempotent).
- **Memory-leak detection** — `MemoryMonitor` with least-squares heap-growth
  trend (MB/min) and absolute-heap alerts.
- **Slack alerts** — webhook delivery with per-key cooldown de-duplication and a
  custom `onAlert` sink. Alert types: `slow-request`, `slow-mongo`, `slow-redis`,
  `memory-leak`, `memory-high`.
- **Snapshot** — `Insights.snapshot()` and a ready-to-mount `/insights` handler.
- Building blocks exported: `Histogram`, `MetricsRegistry`, `MemoryMonitor`.
