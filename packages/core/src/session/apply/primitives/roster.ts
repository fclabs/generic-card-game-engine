import { ok } from "../../../errors/result.js";
import type { Result } from "../../../errors/result.js";
import type { Action, RosterAction } from "../../actions.js";
import { rosterNode } from "../../../replay/canonical/state-schema.js";
import { isPlayerId, isSeatId, isTeamId } from "../../ids.js";
import { hasOwn } from "../../records.js";
import type { Delegation, RosterState } from "../../state.js";
import type { ApplyContext } from "../context.js";
import { invokeReducer, recheck } from "../reducer.js";

type DelegationAction = Extract<
  RosterAction,
  { readonly op: "delegate" | "revoke_delegation" }
>;

/** `roster` ops `delegate` / `revoke_delegation` (KFR-041), identified by `(seat, principal)`. */
export function applyDelegation(
  ctx: ApplyContext,
  action: DelegationAction,
): Result<Action> {
  if (!hasOwn(ctx.work.state.roster.seats, action.seat_id)) {
    return ctx.fail(
      "MALFORMED_ACTION",
      `unknown seat: ${action.seat_id}`,
      ctx.path(".seat_id"),
    );
  }
  const current = ctx.work.state.delegations;
  const same = (d: Delegation) =>
    d.seat === action.seat_id && d.principal === action.grantee_principal;
  const exists = current.some(same);
  if (action.op === "delegate") {
    if (exists) {
      return ctx.fail(
        "MALFORMED_ACTION",
        `delegation already exists for seat ${action.seat_id} and principal ${action.grantee_principal}`,
        ctx.path(".grantee_principal"),
      );
    }
    ctx.work.replace("delegations", [
      ...current,
      {
        seat: action.seat_id,
        principal: action.grantee_principal,
        ...(action.scope !== undefined ? { scope: action.scope } : {}),
        ...(action.boundary !== undefined ? { boundary: action.boundary } : {}),
      },
    ]);
    return ok(action);
  }
  if (!exists) {
    return ctx.fail(
      "MALFORMED_ACTION",
      `no delegation for seat ${action.seat_id} and principal ${action.grantee_principal}`,
      ctx.path(".grantee_principal"),
    );
  }
  ctx.work.replace(
    "delegations",
    current.filter((d) => !same(d)),
  );
  return ok(action);
}

const STATUSES: readonly string[] = ["seated", "sitting_out", "eliminated"];

/** Shape of a roster reducer's output (§6.4, KFR-014): declared seats, valid ids, unique players. */
function rosterProblem(ctx: ApplyContext, value: unknown): string | undefined {
  const declared = new Set<string>(ctx.def.seats.map((s) => s.id));
  const players = new Set<string>();
  const seats = (value as RosterState).seats;
  for (const [seat, entry] of Object.entries(seats)) {
    if (!isSeatId(seat) || !declared.has(seat)) {
      return `seat ${seat} is not a declared seat`;
    }
    if (!STATUSES.includes(entry.status)) {
      return `seat ${seat} has invalid status ${entry.status}`;
    }
    if (entry.player !== undefined) {
      if (!isPlayerId(entry.player))
        return `seat ${seat} has an invalid player`;
      if (players.has(entry.player)) {
        return `player ${entry.player} holds more than one seat`;
      }
      players.add(entry.player);
    }
    if (
      entry.team !== undefined &&
      (!isTeamId(entry.team) || !ctx.def.teams.some((t) => t === entry.team))
    ) {
      return `seat ${seat} names undeclared team ${entry.team}`;
    }
  }
  return undefined;
}

/**
 * `roster` ops `join leave substitute set_status` (KFR-042): the definition's roster reducer
 * receives the `roster` partition and the action; its output replaces `roster` only.
 */
export function applyRosterReducer(
  ctx: ApplyContext,
  action: RosterAction,
): Result<Action> {
  const reducer = ctx.def.rosterReducer;
  if (reducer === undefined) {
    return ctx.fail(
      "MALFORMED_ACTION",
      `no roster reducer registered for op ${action.op}`,
      ctx.path(".op"),
    );
  }
  const out = invokeReducer(ctx, reducer, ctx.work.state.roster, action, {
    name: "roster",
    schema: rosterNode,
    check: (value) => rosterProblem(ctx, value),
  });
  if (!out.ok) return out;
  ctx.work.replace("roster", out.value);
  const rechecked = recheck(ctx, "roster");
  return rechecked.ok ? ok(action) : rechecked;
}
