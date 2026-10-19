import { ok } from "../../../errors/result.js";
import type { Result } from "../../../errors/result.js";
import type { CounterDecl, RoundingMode } from "../../../definition/types.js";
import type {
  Action,
  CounterAdjustAction,
  CounterTransferAction,
  Ratio,
} from "../../actions.js";
import { getOwn } from "../../records.js";
import { ratioRound } from "../../ratio.js";
import type { ApplyContext } from "../context.js";

/** `applied` of a `counter_adjust` (KFR-034): `delta`, or `ratioRound(delta, ratio)` with a ratio. */
export function adjustApplied(
  action: CounterAdjustAction,
  mode: RoundingMode | undefined,
): bigint {
  if (action.ratio === undefined) return action.delta;
  return ratioRound(action.delta, action.ratio, mode ?? "floor");
}

/** `credited` and `remainder = amount - credited` of a `counter_transfer` (KFR-035). */
export function transferAmounts(
  action: CounterTransferAction,
  mode: RoundingMode | undefined,
): { readonly credited: bigint; readonly remainder: bigint } {
  const credited =
    action.ratio === undefined
      ? action.amount
      : ratioRound(action.amount, action.ratio, mode ?? "floor");
  return { credited, remainder: action.amount - credited };
}

/** Net per-counter changes of a `counter_transfer`, summed per counter id (aliasing). */
export function transferChanges(
  action: CounterTransferAction,
  mode: RoundingMode | undefined,
): ReadonlyMap<string, bigint> {
  const { credited, remainder } = transferAmounts(action, mode);
  const changes = new Map<string, bigint>();
  const add = (id: string, by: bigint) =>
    changes.set(id, (changes.get(id) ?? 0n) + by);
  add(action.from_counter, -action.amount);
  add(action.to_counter, credited);
  if (action.remainder_to !== undefined) add(action.remainder_to, remainder);
  return changes;
}

/** A stored (non-derived) counter's declaration, or a failure naming the counter. */
function storedDecl(
  ctx: ApplyContext,
  id: string,
  path: string,
): Result<CounterDecl> {
  const decl = ctx.index.counter(id);
  if (decl === undefined) {
    return ctx.fail("MALFORMED_ACTION", `unknown counter: ${id}`, path);
  }
  if (decl.derived !== undefined) {
    return ctx.fail(
      "MALFORMED_ACTION",
      `derived counter cannot be changed: ${id}`,
      path,
    );
  }
  return ok(decl);
}

function ratioMode(
  ctx: ApplyContext,
  decl: CounterDecl,
  ratio: Ratio,
): Result<RoundingMode> {
  if (ratio.den <= 0n) {
    return ctx.fail(
      "MALFORMED_ACTION",
      `ratio.den must be positive (counter ${decl.id})`,
      ctx.path(".ratio.den"),
    );
  }
  if (decl.rounding === undefined) {
    return ctx.fail(
      "MALFORMED_ACTION",
      `counter ${decl.id} declares no rounding mode, so a ratio is not allowed`,
      ctx.path(".ratio"),
    );
  }
  return ok(decl.rounding);
}

/** Checks `value` against the declared bounds of `decl` (KFR-060). */
function checkBounds(
  ctx: ApplyContext,
  decl: CounterDecl,
  value: bigint,
): Result<void> {
  if (value < decl.min || (decl.max !== undefined && value > decl.max)) {
    const max = decl.max === undefined ? "none" : decl.max.toString();
    return ctx.fail(
      "COUNTER_BOUNDS",
      `counter ${decl.id} would be ${value.toString()}, outside [${decl.min.toString()}, ${max}]`,
    );
  }
  return ok(undefined);
}

function currentValue(ctx: ApplyContext, decl: CounterDecl): bigint {
  return getOwn(ctx.work.state.counters, decl.id) ?? decl.initial;
}

/** `counter_adjust` (KFR-034). */
export function applyCounterAdjust(
  ctx: ApplyContext,
  action: CounterAdjustAction,
): Result<Action> {
  const decl = storedDecl(ctx, action.counter_id, ctx.path(".counter_id"));
  if (!decl.ok) return decl;
  let mode: RoundingMode | undefined;
  if (action.ratio !== undefined) {
    const m = ratioMode(ctx, decl.value, action.ratio);
    if (!m.ok) return m;
    mode = m.value;
  }
  const value = currentValue(ctx, decl.value) + adjustApplied(action, mode);
  const bounded = checkBounds(ctx, decl.value, value);
  if (!bounded.ok) return bounded;
  ctx.work.patch("counters", decl.value.id, value);
  return ok(action);
}

/** `counter_transfer` (KFR-035, KFR-061): mode from the source counter, bounds on final values. */
export function applyCounterTransfer(
  ctx: ApplyContext,
  action: CounterTransferAction,
): Result<Action> {
  if (action.amount < 0n) {
    return ctx.fail(
      "MALFORMED_ACTION",
      `negative transfer amount ${action.amount.toString()} (from ${action.from_counter})`,
      ctx.path(".amount"),
    );
  }
  const from = storedDecl(ctx, action.from_counter, ctx.path(".from_counter"));
  if (!from.ok) return from;
  const to = storedDecl(ctx, action.to_counter, ctx.path(".to_counter"));
  if (!to.ok) return to;
  let rest: CounterDecl | undefined;
  if (action.remainder_to !== undefined) {
    const r = storedDecl(ctx, action.remainder_to, ctx.path(".remainder_to"));
    if (!r.ok) return r;
    rest = r.value;
  }
  let mode: RoundingMode | undefined;
  if (action.ratio !== undefined) {
    const m = ratioMode(ctx, from.value, action.ratio);
    if (!m.ok) return m;
    mode = m.value;
  }
  const { remainder } = transferAmounts(action, mode);
  if (remainder !== 0n && action.remainder_to === undefined) {
    return ctx.fail(
      "MALFORMED_ACTION",
      `rounding remainder ${remainder.toString()} needs remainder_to (from ${action.from_counter})`,
      ctx.path(".remainder_to"),
    );
  }
  const changes = transferChanges(action, mode);
  const decls = new Map<string, CounterDecl>(
    [from.value, to.value, ...(rest ? [rest] : [])].map((d) => [d.id, d]),
  );
  const finals: [string, bigint][] = [];
  for (const [id, change] of changes) {
    const decl = decls.get(id);
    if (decl === undefined) continue;
    const value = currentValue(ctx, decl) + change;
    const bounded = checkBounds(ctx, decl, value);
    if (!bounded.ok) return bounded;
    finals.push([id, value]);
  }
  for (const [id, value] of finals) ctx.work.patch("counters", id, value);
  return ok(action);
}
