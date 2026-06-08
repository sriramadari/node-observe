import { describe, expect, it } from "vitest";
import { normalizePath } from "../src/util";
import { formatSlackMessage } from "../src/slack";
import type { Alert } from "../src/types";

describe("normalizePath", () => {
  it("collapses numeric ids", () => {
    expect(normalizePath("/users/12/posts/345")).toBe("/users/:id/posts/:id");
  });
  it("collapses Mongo ObjectIds", () => {
    expect(normalizePath("/users/64b8f0c2a1b2c3d4e5f60718")).toBe("/users/:id");
  });
  it("collapses UUIDs", () => {
    expect(normalizePath("/x/123e4567-e89b-12d3-a456-426614174000")).toBe("/x/:id");
  });
  it("strips query strings and leaves static segments", () => {
    expect(normalizePath("/api/v1/health?foo=1")).toBe("/api/v1/health");
  });
});

describe("formatSlackMessage", () => {
  it("includes service, type, value and threshold", () => {
    const alert: Alert = {
      type: "slow-request",
      key: "GET /x",
      message: "GET /x took 1200ms",
      value: 1200,
      threshold: 1000,
      at: "2026-06-08T00:00:00.000Z",
    };
    const text = formatSlackMessage(alert, "api");
    expect(text).toContain("[api] slow-request");
    expect(text).toContain("GET /x took 1200ms");
    expect(text).toContain("1200");
    expect(text).toContain("1000");
  });
});
