import { ok } from "../../../errors/result.js";
import type { Result } from "../../../errors/result.js";
import type {
  Action,
  ControlAdvanceAction,
  ControlSetAction,
} from "../../actions.js";
import type { SeatId } from "../../ids.js";
import { getOwn, hasOwn } from "../../records.js";
import type { ControlState } from "../../state.js";
import type { ApplyContext } from "../context.js";

/** `control_set` (KFR-036, KBR-008): exactly the named fields change. */
export function applyControlSet(
  ctx: ApplyContext,
  action: ControlSetAction,
): Result<Action> {
  const control = ctx.work.state.control;
  const seats = ctx.work.state.roster.seats;
  if (
    action.phase !== undefined &&
    !ctx.def.control.phases.includes(action.phase)
  ) {
    return ctx.fail(
      "MALFORMED_ACTION",
      `phase outside the declared set: ${action.phase}`,
      ctx.path(".phase"),
    );
  }
  for (const [i, seat] of (action.active_seats ?? []).entries()) {
    if (!hasOwn(seats, seat)) {
      return ctx.fail(
        "MALFORMED_ACTION",
        `unknown seat: ${seat}`,
        ctx.path(`.active_seats[${String(i)}]`),
      );
    }
  }
  if (action.pointer !== undefined && !hasOwn(seats, action.pointer.seat)) {
    return ctx.fail(
      "MALFORMED_ACTION",
      `unknown seat: ${action.pointer.seat}`,
      ctx.path(".pointer.seat"),
    );
  }
  if (
    action.phase === undefined &&
    action.active_seats === undefined &&
    action.direction === undefined &&
    action.pointer === undefined
  ) {
    return ok(action);
  }
  const next: ControlState = {
    ...control,
    ...(action.phase !== undefined ? { phase: action.phase } : {}),
    ...(action.active_seats !== undefined
      ? { activeSeats: [...action.active_seats] }
      : {}),
    ...(action.direction !== undefined ? { direction: action.direction } : {}),
    ...(action.pointer !== undefined
      ? {
          pointers: {
            ...control.pointers,
            [action.pointer.name]: action.pointer.seat,
          },
        }
      : {}),
  };
  ctx.work.replace("control", next);
  return ok(action);
}

/**
 * `control_advance` (KFR-037): moves a cursor along `turnOrder` in `direction`, wrapping, counting
 * only `seated` seats (the start seat counts only after wrapping). Cursor = `activeSeats[0]` or the
 * named pointer. Without a pointer `activeSeats` becomes `[newSeat]`; with one only that pointer changes.
 */
export function applyControlAdvance(
  ctx: ApplyContext,
  action: ControlAdvanceAction,
): Result<Action> {
  if (action.mode !== undefined) {
    return ctx.fail(
      "MALFORMED_ACTION",
      `control_advance mode ${action.mode} is not supported`,
      ctx.path(".mode"),
    );
  }
  const control = ctx.work.state.control;
  let start: SeatId | undefined;
  if (action.pointer === undefined) {
    start = control.activeSeats[0];
    if (start === undefined) {
      return ctx.fail(
        "MALFORMED_ACTION",
        "control_advance needs a non-empty active_seats",
        ctx.path(),
      );
    }
  } else {
    start = getOwn(control.pointers, action.pointer);
    if (start === undefined) {
      return ctx.fail(
        "MALFORMED_ACTION",
        `unknown pointer: ${action.pointer}`,
        ctx.path(".pointer"),
      );
    }
  }
  const order = control.turnOrder;
  const from = order.indexOf(start);
  if (from < 0) {
    return ctx.fail(
      "MALFORMED_ACTION",
      `seat ${start} is not in the turn order`,
      ctx.path(),
    );
  }
  // One full lap of seated seats, starting after `start` in `direction` (start itself last).
  const seats = ctx.work.state.roster.seats;
  const lap: SeatId[] = [];
  for (let i = 1; i <= order.length; i++) {
    const at =
      (((from + i * control.direction) % order.length) + order.length) %
      order.length;
    const seat = order[at];
    if (seat !== undefined && getOwn(seats, seat)?.status === "seated") {
      lap.push(seat);
    }
  }
  const landed = lap[(action.steps - 1) % Math.max(lap.length, 1)];
  if (landed === undefined) {
    return ctx.fail("MALFORMED_ACTION", "no seat is seated", ctx.path());
  }
  if (action.pointer === undefined) {
    ctx.work.replace("control", { ...control, activeSeats: [landed] });
  } else {
    ctx.work.replace("control", {
      ...control,
      pointers: { ...control.pointers, [action.pointer]: landed },
    });
  }
  return ok(action);
}
