import { ok } from "../../../errors/result.js";
import type { Result } from "../../../errors/result.js";
import type {
  Action,
  GrantViewAction,
  RevokeViewAction,
} from "../../actions.js";
import type { GrantId } from "../../ids.js";
import { hasOwn } from "../../records.js";
import type { JsonValue } from "../../state.js";
import type { ApplyContext } from "../context.js";

type Plain = { readonly [key: string]: JsonValue };

function plain(value: JsonValue): Plain | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Plain)
    : undefined;
}

/** True when `value` is an object with exactly the given keys. */
function hasKeys(value: Plain, keys: readonly string[]): boolean {
  const own = Object.keys(value);
  return own.length === keys.length && keys.every((k) => hasOwn(value, k));
}

function checkTarget(ctx: ApplyContext, target: JsonValue): string | undefined {
  const t = plain(target);
  if (t === undefined) return "target must be an object";
  switch (t.kind) {
    case "card": {
      if (!hasKeys(t, ["kind", "card_id"])) return "malformed card target";
      return typeof t.card_id === "string" && ctx.work.card(t.card_id)
        ? undefined
        : `unknown card: ${JSON.stringify(t.card_id)}`;
    }
    case "zone":
    case "top": {
      if (!hasKeys(t, ["kind", "zone_id"])) return `malformed ${t.kind} target`;
      const id = t.zone_id;
      const zone = typeof id === "string" ? ctx.work.zone(id) : undefined;
      if (typeof id !== "string" || zone === undefined) {
        return `unknown zone: ${JSON.stringify(id)}`;
      }
      if (t.kind === "top" && !ctx.index.isOrdered(id, zone)) {
        return `top target needs an ordered zone: ${id}`;
      }
      return undefined;
    }
    default:
      return `unsupported target kind: ${JSON.stringify(t.kind)}`;
  }
}

function checkScope(ctx: ApplyContext, scope: JsonValue): string | undefined {
  const s = plain(scope);
  if (s === undefined) return "scope must be an object";
  switch (s.kind) {
    case "until_revoked":
    case "once":
      return hasKeys(s, ["kind"]) ? undefined : `malformed ${s.kind} scope`;
    case "until_seq":
      if (!hasKeys(s, ["kind", "n"])) return "malformed until_seq scope";
      return typeof s.n === "number" &&
        Number.isSafeInteger(s.n) &&
        s.n >= ctx.seq
        ? undefined
        : `until_seq n must be a safe integer >= ${String(ctx.seq)}`;
    default:
      return `unknown scope kind: ${JSON.stringify(s.kind)}`;
  }
}

function checkKeys(
  ctx: ApplyContext,
  keys: readonly string[],
): string | undefined {
  if (keys.length === 0) return "keys must not be empty";
  const seen = new Set<string>();
  for (const key of keys) {
    if (seen.has(key)) return `duplicate key: ${key}`;
    seen.add(key);
    if (!ctx.def.viewKeys.includes(key)) return `key outside viewKeys: ${key}`;
  }
  return undefined;
}

function checkGrantee(ctx: ApplyContext, grantee: string): string | undefined {
  if (grantee === "all_seated") return undefined;
  if (grantee.startsWith("team:")) {
    const team = grantee.slice("team:".length);
    return ctx.def.teams.includes(team as never)
      ? undefined
      : `unknown team: ${team}`;
  }
  return ctx.def.seats.some((s) => s.id === grantee)
    ? undefined
    : `grantee is not a declared seat, all_seated or team:<id>: ${grantee}`;
}

/**
 * `grant_view` (KFR-040): validates target, keys, grantee and scope, stores the grant under
 * `grant/<seq+1>/<position in the committed list>` and logs that id as `grant_id`.
 */
export function applyGrantView(
  ctx: ApplyContext,
  action: GrantViewAction,
): Result<Action> {
  const checks: readonly [string, string | undefined][] = [
    [".target", checkTarget(ctx, action.target)],
    [".keys", checkKeys(ctx, action.keys)],
    [".grantee", checkGrantee(ctx, action.grantee)],
    [".scope", checkScope(ctx, action.scope)],
  ];
  for (const [suffix, problem] of checks) {
    if (problem !== undefined) {
      return ctx.fail("MALFORMED_ACTION", problem, ctx.path(suffix));
    }
  }
  const id = `grant/${String(ctx.seq)}/${String(ctx.position)}` as GrantId;
  if (action.grant_id !== undefined && action.grant_id !== id) {
    return ctx.fail(
      "MALFORMED_ACTION",
      `grant_id ${action.grant_id} differs from the derived id ${id}`,
      ctx.path(".grant_id"),
    );
  }
  ctx.work.patch("grants", id, {
    target: action.target,
    keys: [...action.keys],
    grantee: action.grantee,
    scope: action.scope,
  });
  return ok({ ...action, grant_id: id });
}

/** `revoke_view` (KFR-040): removes an existing grant. */
export function applyRevokeView(
  ctx: ApplyContext,
  action: RevokeViewAction,
): Result<Action> {
  if (!hasOwn(ctx.work.state.grants, action.grant_id)) {
    return ctx.fail(
      "MALFORMED_ACTION",
      `unknown grant: ${action.grant_id}`,
      ctx.path(".grant_id"),
    );
  }
  ctx.work.patch("grants", action.grant_id, undefined);
  return ok(action);
}
