import type { Insights } from "./insights";
import { elapsedMs } from "./util";

const PATCHED = Symbol.for("nodeObserve.redisPatched");

interface CommandLike {
  name?: string;
  promise?: Promise<unknown>;
}
interface RedisLike {
  sendCommand?: (command: CommandLike, ...rest: unknown[]) => unknown;
  [PATCHED]?: boolean;
}

/**
 * Instrument an ioredis client by wrapping `sendCommand`, timing every command
 * (`get`, `set`, `hgetall`, …) via the command's own promise. Safe to call once
 * per client; re-instrumenting the same client is a no-op.
 *
 * @example
 * ```ts
 * import Redis from "ioredis";
 * const redis = new Redis(url);
 * insights.instrumentRedis(redis);
 * ```
 */
export function instrumentRedis(client: unknown, insights: Insights): void {
  const c = client as RedisLike;
  if (!c || typeof c.sendCommand !== "function") {
    insights.logger.warn?.("node-observe: instrumentRedis called with a non-ioredis value; skipping");
    return;
  }
  if (c[PATCHED]) return;
  c[PATCHED] = true;

  const original = c.sendCommand.bind(c);
  c.sendCommand = function patchedSendCommand(command: CommandLike, ...rest: unknown[]) {
    const start = process.hrtime.bigint();
    const name = (command?.name ?? "unknown").toLowerCase();
    const result = original(command, ...rest);
    const promise = command?.promise ?? (result as Promise<unknown> | undefined);
    if (promise && typeof (promise as Promise<unknown>).then === "function") {
      (promise as Promise<unknown>).then(
        () => insights.recordRedis(name, elapsedMs(start), false),
        () => insights.recordRedis(name, elapsedMs(start), true),
      );
    }
    return result;
  };
}
