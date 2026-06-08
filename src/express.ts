import type { Insights } from "./insights";
import { elapsedMs } from "./util";

/** Minimal shapes so we don't need `express` as a dependency. */
export interface ObserveRequest {
  method?: string;
  route?: { path?: string };
  baseUrl?: string;
  originalUrl?: string;
  path?: string;
  url?: string;
}
export interface ObserveResponse {
  statusCode?: number;
  on(event: "finish" | "close", listener: () => void): void;
}
export type ObserveNext = () => void;

/**
 * Express/Connect middleware that records request latency on response finish.
 * Prefers the matched route pattern (`req.route.path`) to keep cardinality low,
 * falling back to the raw path.
 */
export function instrumentExpress(insights: Insights) {
  return function nodeObserveMiddleware(req: ObserveRequest, res: ObserveResponse, next: ObserveNext): void {
    const start = process.hrtime.bigint();
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      const ms = elapsedMs(start);
      const method = req.method ?? "GET";
      const route = routeOf(req);
      insights.recordRequest(method, route, res.statusCode ?? 0, ms);
    };
    res.on("finish", finish);
    res.on("close", finish);
    next();
  };
}

function routeOf(req: ObserveRequest): string {
  // `req.route.path` is the matched pattern (e.g. "/users/:id") — best for grouping.
  if (req.route?.path) {
    const base = req.baseUrl ?? "";
    return base + req.route.path || req.route.path;
  }
  return req.path ?? (req.originalUrl ?? req.url ?? "unknown").split("?")[0] ?? "unknown";
}
