import { ok } from "../../../errors/result.js";
import type { Result } from "../../../errors/result.js";
import type { Action, RosterAction } from "../../actions.js";
import { hasOwn } from "../../records.js";
import type { Delegation } from "../../state.js";
import type { ApplyContext } from "../context.js";

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
