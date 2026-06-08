import type { Insights } from "./insights";
import { elapsedMs } from "./util";

const START = Symbol("nodeObserveStart");

/** Minimal Mongoose shapes (avoids a hard dependency on `mongoose`). */
interface SchemaLike {
  pre(hook: string | RegExp | string[], fn: (this: any) => void): void;
  post(hook: string | RegExp | string[], fn: (this: any, ...args: any[]) => void): void;
}
interface MongooseLike {
  plugin(fn: (schema: SchemaLike) => void): unknown;
}

const QUERY_HOOK = /^(find|findOne|findOneAnd|count|countDocuments|estimatedDocumentCount|update|updateOne|updateMany|delete|deleteOne|deleteMany|replaceOne)/;

/**
 * Register a global Mongoose plugin that times every query, aggregate, and
 * document save, recording `<Model>.<op>` durations on the given Insights.
 *
 * Call this **before** your models are compiled (i.e. right after you import
 * mongoose) so the plugin applies to every schema.
 *
 * @example
 * ```ts
 * import mongoose from "mongoose";
 * insights.instrumentMongoose(mongoose);
 * ```
 */
export function instrumentMongoose(mongoose: unknown, insights: Insights): void {
  const m = mongoose as MongooseLike;
  if (!m || typeof m.plugin !== "function") {
    insights.logger.warn?.("node-observe: instrumentMongoose called with a non-mongoose value; skipping");
    return;
  }

  m.plugin((schema: SchemaLike) => {
    // --- query middleware (find/update/delete/count/...) ---
    schema.pre(QUERY_HOOK, function (this: any) {
      this[START] = process.hrtime.bigint();
    });
    schema.post(QUERY_HOOK, function (this: any) {
      finish(insights, modelName(this), this.op ?? "query", this[START]);
    });

    // --- aggregate middleware ---
    schema.pre("aggregate", function (this: any) {
      this[START] = process.hrtime.bigint();
    });
    schema.post("aggregate", function (this: any) {
      finish(insights, aggregateModelName(this), "aggregate", this[START]);
    });

    // --- document save middleware ---
    schema.pre("save", function (this: any) {
      this[START] = process.hrtime.bigint();
    });
    schema.post("save", function (this: any) {
      finish(insights, this?.constructor?.modelName ?? "Document", "save", this[START]);
    });
  });
}

function finish(insights: Insights, model: string, op: string, start: bigint | undefined): void {
  if (typeof start !== "bigint") return;
  insights.recordMongo(`${model}.${op}`, elapsedMs(start));
}

function modelName(query: any): string {
  return query?.model?.modelName ?? query?.mongooseCollection?.name ?? "Model";
}

function aggregateModelName(agg: any): string {
  return agg?._model?.modelName ?? agg?.model?.()?.modelName ?? "Model";
}
