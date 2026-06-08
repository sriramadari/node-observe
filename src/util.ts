/**
 * Collapse high-cardinality path segments so routes group together in metrics.
 * Numeric ids, Mongo ObjectIds, UUIDs, and long hex tokens all become `:id`.
 *
 * `/users/64b8.../posts/12` → `/users/:id/posts/:id`
 */
export function normalizePath(path: string): string {
  const clean = path.split("?")[0] ?? path;
  return clean
    .split("/")
    .map((seg) => {
      if (seg === "") return seg;
      if (/^\d+$/.test(seg)) return ":id";
      if (/^[0-9a-f]{24}$/i.test(seg)) return ":id"; // ObjectId
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg)) return ":id"; // UUID
      if (/^[0-9a-f]{32,}$/i.test(seg)) return ":id"; // long hex token
      return seg;
    })
    .join("/");
}

/** Elapsed milliseconds since an `process.hrtime.bigint()` start, as a float. */
export function elapsedMs(start: bigint): number {
  return Number(process.hrtime.bigint() - start) / 1e6;
}
