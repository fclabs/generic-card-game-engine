import { canonicalize } from "../../replay/canonical/canonicalize.js";
import type { CanonicalSchema } from "../../replay/canonical/schema.js";
import type { Reducer } from "../reducer.js";
import { deepFreeze } from "../snapshot.js";
import type { Snapshot } from "../snapshot.js";
import { ok } from "../../errors/result.js";
import type { Result } from "../../errors/result.js";
import type { ApplyContext } from "./context.js";
import { findInvariantViolation } from "./invariants.js";

/** Deeper than the canonical `json` limit (64) plus the partition's own nesting. */
const CLONE_DEPTH = 80;

/**
 * Detached plain-data copy of a reducer's return value, so that getters, shared references or
 * later mutation by the reducer's author cannot change what was validated. Only plain objects
 * and arrays are descended into; everything else is returned as-is for the canonical check to
 * reject. Throws on cycles and on nesting deeper than `CLONE_DEPTH`.
 */
function cloneData(value: unknown, path: Set<object>, depth: number): unknown {
  if (typeof value !== "object" || value === null) return value;
  if (path.has(value)) throw new Error("cyclic structure");
  if (depth > CLONE_DEPTH) throw new Error("structure nested too deeply");
  const proto: unknown = Object.getPrototypeOf(value);
  const isArray = Array.isArray(value);
  if (!isArray && proto !== Object.prototype && proto !== null) return value;
  path.add(value);
  try {
    if (isArray) {
      return (value as unknown[]).map((item) =>
        cloneData(item, path, depth + 1),
      );
    }
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      Object.defineProperty(out, key, {
        value: cloneData(item, path, depth + 1),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return out;
  } finally {
    path.delete(value);
  }
}

function describe(thrown: unknown): string {
  if (thrown instanceof Error) return thrown.message;
  return typeof thrown === "string" ? thrown : "non-error value thrown";
}

export interface PartitionSpec {
  /** Names the partition in error details, e.g. `meta notes` or `roster`. */
  readonly name: string;
  /** Canonical schema the output must serialise under (KFR-050). */
  readonly schema: CanonicalSchema;
  /** Shape rules beyond the schema (§6.4); returns a problem or `undefined`. */
  readonly check?: (value: unknown) => string | undefined;
}

/**
 * The generic reducer step (KFR-050). Calls `reducer(partition, payload)` with deep-frozen
 * inputs, then validates the return value: no throw, serialisable under the partition's
 * canonical schema, shape per `spec.check`, and no other partition of the working state
 * changed (reference comparison). The partition is returned detached and deep-frozen. Any
 * failure is `REDUCER_ERROR` at the input action's index. The caller writes the partition
 * and then calls `recheck` (structural invariants and counter bounds, KBR-010).
 */
export function invokeReducer<S>(
  ctx: ApplyContext,
  reducer: Reducer<S>,
  partition: Snapshot<S>,
  payload: unknown,
  spec: PartitionSpec,
): Result<Snapshot<S>> {
  const fail = (detail: string) =>
    ctx.fail("REDUCER_ERROR", `${spec.name} reducer: ${detail}`);
  const before = { ...ctx.work.state };
  let returned: unknown;
  try {
    returned = reducer(partition, deepFreeze(payload));
  } catch (thrown) {
    return fail(`threw: ${describe(thrown)}`);
  }
  let copy: unknown;
  try {
    copy = cloneData(returned, new Set(), 0);
  } catch (thrown) {
    return fail(`output is not plain data: ${describe(thrown)}`);
  }
  try {
    canonicalize(spec.schema, copy);
  } catch (thrown) {
    return fail(`output is not serialisable: ${describe(thrown)}`);
  }
  const problem = spec.check?.(copy);
  if (problem !== undefined) return fail(`ill-shaped output: ${problem}`);
  const after: Record<string, unknown> = { ...ctx.work.state };
  for (const key of Object.keys(before)) {
    if (!Object.is(before[key as keyof typeof before], after[key])) {
      return fail(`changed ${key}, outside its own partition`);
    }
  }
  return ok(deepFreeze(copy as S));
}

/** KBR-010: re-checks structural invariants and counter bounds after a reducer wrote. */
export function recheck(ctx: ApplyContext, name: string): Result<void> {
  const problem = findInvariantViolation(ctx.def, ctx.work.state);
  return problem === undefined
    ? ok(undefined)
    : ctx.fail(
        "REDUCER_ERROR",
        `${name} reducer broke an invariant: ${problem}`,
      );
}
