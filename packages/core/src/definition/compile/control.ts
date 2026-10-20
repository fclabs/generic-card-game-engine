import type { SeatId } from "../../session/ids.js";
import type { ControlDecl } from "../types.js";
import type { ErrorCollector } from "./errors.js";
import { checkId } from "./ids.js";
import { MAX_PHASES } from "./limits.js";
import {
  has,
  indexPath,
  joinPath,
  member,
  readArray,
  readBoolean,
  readObject,
  readString,
  readStringList,
} from "./strict.js";

const KEYS = [
  "phases",
  "initial_phase",
  "turn_order",
  "initial_active_seats",
  "pointers",
  "enforce_active_seats",
  "out_of_turn",
] as const;

/** Reads a list of ids; each checked against the charset. */
function readIdList(
  c: ErrorCollector,
  raw: unknown,
  path: string,
  what: string,
): string[] | undefined {
  const items = readArray(c, raw, path);
  if (items === undefined) return undefined;
  const out: string[] = [];
  let good = true;
  items.forEach((item, i) => {
    const p = indexPath(path, i);
    const s = readString(c, item, p);
    if (s === undefined || !checkId(c, s, p, what, s)) good = false;
    else out.push(s);
  });
  return good ? out : undefined;
}

/** Reports the second and later occurrences of a value as `DUPLICATE_ID`. */
function reportDuplicates(
  c: ErrorCollector,
  values: readonly string[],
  path: string,
  what: string,
): void {
  const seen = new Set<string>();
  values.forEach((v, i) => {
    if (seen.has(v)) {
      c.add("DUPLICATE_ID", indexPath(path, i), `duplicate ${what} "${v}"`, v);
    }
    seen.add(v);
  });
}

/** Checks each seat id against the declared seats (`UNKNOWN_REFERENCE`). */
function checkSeats(
  c: ErrorCollector,
  values: readonly string[],
  path: string,
  seats: readonly string[] | undefined,
): void {
  if (seats === undefined) return;
  values.forEach((v, i) => {
    if (!seats.includes(v)) {
      c.add(
        "UNKNOWN_REFERENCE",
        indexPath(path, i),
        `seat "${v}" is not declared`,
        v,
      );
    }
  });
}

/**
 * Compiles `control` (DFR-019). The caller passes `{}` when the section is
 * absent (all defaults). `seats` is `undefined` when the seat layout failed,
 * which skips every seat reference check. Returns `undefined` when anything
 * was reported.
 */
export function compileControl(
  c: ErrorCollector,
  raw: unknown,
  path: string,
  seats: readonly string[] | undefined,
): ControlDecl | undefined {
  const before = c.count;
  const obj = readObject(c, raw, path, KEYS);
  if (obj === undefined) return undefined;

  // phases / initial_phase
  let phases: string[] | undefined = ["main"];
  if (has(obj, "phases")) {
    const pp = joinPath(path, "phases");
    phases = readIdList(c, member(obj, "phases"), pp, "phase id");
    if (phases !== undefined) {
      if (phases.length === 0) {
        c.add("INVALID_VALUE", pp, "phases must not be empty");
      } else if (phases.length > MAX_PHASES) {
        c.add(
          "LIMIT_EXCEEDED",
          pp,
          `${phases.length} phases exceed the limit of ${MAX_PHASES}`,
        );
      } else reportDuplicates(c, phases, pp, "phase");
    }
    if (!has(obj, "initial_phase")) {
      c.add(
        "SCHEMA_MISSING",
        joinPath(path, "initial_phase"),
        'missing required key "initial_phase" (required when phases is given)',
      );
    }
  }
  let initialPhase: string | undefined = "main";
  if (has(obj, "initial_phase")) {
    const ip = joinPath(path, "initial_phase");
    initialPhase = readString(c, member(obj, "initial_phase"), ip);
    if (
      initialPhase !== undefined &&
      phases !== undefined &&
      !phases.includes(initialPhase)
    ) {
      c.add(
        "INVALID_VALUE",
        ip,
        `initial_phase "${initialPhase}" is not in phases`,
        initialPhase,
      );
      initialPhase = undefined;
    }
  } else if (has(obj, "phases")) initialPhase = undefined;

  // turn_order
  let turnOrder: string[] | undefined =
    seats === undefined ? undefined : [...seats];
  if (has(obj, "turn_order")) {
    const tp = joinPath(path, "turn_order");
    turnOrder = readIdList(c, member(obj, "turn_order"), tp, "seat id");
    if (turnOrder !== undefined) {
      reportDuplicates(c, turnOrder, tp, "seat in turn_order");
      checkSeats(c, turnOrder, tp, seats);
      if (seats !== undefined) {
        for (const seat of seats) {
          if (!turnOrder.includes(seat)) {
            c.add("INVALID_VALUE", tp, `turn_order omits seat "${seat}"`, seat);
          }
        }
      }
    }
  }

  // initial_active_seats
  let active: string[] | undefined =
    turnOrder === undefined
      ? undefined
      : turnOrder[0] === undefined
        ? []
        : [turnOrder[0]];
  if (has(obj, "initial_active_seats")) {
    const ap = joinPath(path, "initial_active_seats");
    active = readIdList(c, member(obj, "initial_active_seats"), ap, "seat id");
    if (active !== undefined) {
      if (active.length === 0) {
        c.add("INVALID_VALUE", ap, "initial_active_seats must not be empty");
      }
      reportDuplicates(c, active, ap, "active seat");
      checkSeats(c, active, ap, seats);
    }
  }

  // pointers
  let pointers: string[] | undefined = [];
  if (has(obj, "pointers")) {
    const pp = joinPath(path, "pointers");
    pointers = readIdList(c, member(obj, "pointers"), pp, "pointer name");
    if (pointers !== undefined) reportDuplicates(c, pointers, pp, "pointer");
  }

  let enforce: boolean | undefined = false;
  if (has(obj, "enforce_active_seats")) {
    enforce = readBoolean(
      c,
      member(obj, "enforce_active_seats"),
      joinPath(path, "enforce_active_seats"),
    );
  }
  let outOfTurn: readonly string[] | undefined = [];
  if (has(obj, "out_of_turn")) {
    outOfTurn = readStringList(
      c,
      member(obj, "out_of_turn"),
      joinPath(path, "out_of_turn"),
    );
  }

  if (
    c.count !== before ||
    phases === undefined ||
    initialPhase === undefined ||
    turnOrder === undefined ||
    active === undefined ||
    pointers === undefined ||
    enforce === undefined ||
    outOfTurn === undefined
  ) {
    return undefined;
  }
  return {
    phases,
    initialPhase,
    turnOrder: turnOrder as SeatId[],
    initialActiveSeats: active as SeatId[],
    pointerNames: pointers,
    enforceActiveSeats: enforce,
    outOfTurnKinds: outOfTurn,
  };
}
