import { ok } from "../../../errors/result.js";
import type { Result } from "../../../errors/result.js";
import type { Action, MetaAction } from "../../actions.js";
import { isGateId, isSeatId } from "../../ids.js";
import type { SeatId } from "../../ids.js";
import { getOwn, hasOwn, setOwn } from "../../records.js";
import type {
  Gate,
  JsonValue,
  ResolvedGate,
  SessionState,
} from "../../state.js";
import type { ApplyContext } from "../context.js";

/** Namespace reserved for engine-supplied reducers (KFR-051/052). */
export const ENGINE_PREFIX = "engine.";

type Payload = { readonly [key: string]: JsonValue };

/** `payload` as a plain object with exactly the `required` keys, or a problem message. */
function exactPayload(
  payload: JsonValue,
  required: readonly string[],
): Payload | string {
  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload)
  ) {
    return "payload must be an object";
  }
  const record = payload as Payload;
  for (const key of required) {
    if (!hasOwn(record, key)) return `missing field: ${key}`;
  }
  for (const key of Object.keys(record)) {
    if (!required.includes(key)) return `unexpected field: ${key}`;
  }
  return record;
}

type Gates = SessionState["gates"];

function without<V>(
  record: Readonly<Record<string, V>>,
  id: string,
): Record<string, V> {
  const copy = { ...record };
  Reflect.deleteProperty(copy, id);
  return copy;
}

function withEntry<V>(
  record: Readonly<Record<string, V>>,
  id: string,
  value: V,
): Record<string, V> {
  const copy = { ...record };
  setOwn(copy, id, value);
  return copy;
}

/** Looks up a gate: `open`, `resolved` or unknown. */
function findGate(
  gates: Gates,
  id: string,
): { open: Gate } | { resolved: ResolvedGate } | undefined {
  const open = getOwn(gates.open, id);
  if (open !== undefined) return { open };
  const resolved = getOwn(gates.resolved, id);
  return resolved !== undefined ? { resolved } : undefined;
}

/**
 * Engine-supplied reducers for the reserved `engine.*` schemas (KFR-051, KBR-007). Payloads
 * are exhaustive (missing or extra fields are `MALFORMED_ACTION`); `schema_id` and submission
 * payloads are opaque canonical JSON. The logged action is the input action.
 */
export function applyEngineAction(
  ctx: ApplyContext,
  action: MetaAction,
): Result<Action> {
  const malformed = (detail: string, suffix = ".payload") =>
    ctx.fail("MALFORMED_ACTION", detail, ctx.path(suffix));
  const closed = (detail: string) => ctx.fail("GATE_CLOSED", detail);
  const name = action.schema_id.slice(ENGINE_PREFIX.length);
  const state = ctx.work.state;

  const fields = (required: readonly string[]) =>
    exactPayload(action.payload, required);

  switch (name) {
    case "gate_open": {
      const p = fields(["gate_id", "schema_id", "expected_seats"]);
      if (typeof p === "string") return malformed(p);
      const { gate_id: gateId, schema_id: schemaId, expected_seats: seats } = p;
      if (!isGateId(gateId)) {
        return malformed(`invalid gate_id: ${JSON.stringify(gateId)}`);
      }
      if (typeof schemaId !== "string" || schemaId === "") {
        return malformed(
          `gate ${gateId}: schema_id must be a non-empty string`,
        );
      }
      if (!Array.isArray(seats) || seats.length === 0) {
        return malformed(
          `gate ${gateId}: expected_seats must be a non-empty list`,
        );
      }
      const expected: SeatId[] = [];
      for (const seat of seats as readonly JsonValue[]) {
        if (!isSeatId(seat) || !hasOwn(state.roster.seats, seat)) {
          return malformed(
            `gate ${gateId}: unknown seat ${JSON.stringify(seat)}`,
          );
        }
        if (expected.includes(seat)) {
          return malformed(`gate ${gateId}: duplicate seat ${seat}`);
        }
        expected.push(seat);
      }
      if (findGate(state.gates, gateId) !== undefined) {
        return malformed(`gate ${gateId} already exists`);
      }
      ctx.work.replace("gates", {
        open: withEntry<Gate>(state.gates.open, gateId, {
          schemaId,
          expectedSeats: expected,
          submissions: {},
        }),
        resolved: state.gates.resolved,
      });
      return ok(action);
    }
    case "gate_submit":
    case "gate_retract": {
      const submit = name === "gate_submit";
      const p = fields(
        submit ? ["gate_id", "seat", "payload"] : ["gate_id", "seat"],
      );
      if (typeof p === "string") return malformed(p);
      const { gate_id: gateId, seat } = p;
      if (typeof gateId !== "string" || typeof seat !== "string") {
        return malformed("gate_id and seat must be strings");
      }
      const found = findGate(state.gates, gateId);
      if (found === undefined) return malformed(`unknown gate: ${gateId}`);
      if ("resolved" in found) return closed(`gate ${gateId} is resolved`);
      const gate = found.open;
      if (submit) {
        if (!gate.expectedSeats.some((s) => s === seat)) {
          return closed(`seat ${seat} is not expected by gate ${gateId}`);
        }
      } else if (!hasOwn(gate.submissions, seat)) {
        return malformed(
          `gate ${gateId} holds no submission from seat ${seat}`,
        );
      }
      const submissions = submit
        ? withEntry(gate.submissions, seat, p.payload as JsonValue)
        : without(gate.submissions, seat);
      ctx.work.replace("gates", {
        open: withEntry<Gate>(state.gates.open, gateId, {
          ...gate,
          submissions,
        }),
        resolved: state.gates.resolved,
      });
      return ok(action);
    }
    case "gate_resolve": {
      const p = fields(["gate_id"]);
      if (typeof p === "string") return malformed(p);
      const gateId = p.gate_id;
      if (typeof gateId !== "string")
        return malformed("gate_id must be a string");
      const found = findGate(state.gates, gateId);
      if (found === undefined) return malformed(`unknown gate: ${gateId}`);
      if ("resolved" in found) {
        return closed(`gate ${gateId} is already resolved`);
      }
      ctx.work.replace("gates", {
        open: without(state.gates.open, gateId),
        resolved: withEntry(state.gates.resolved, gateId, found.open),
      });
      return ok(action);
    }
    case "grant_expire":
    case "grant_consume": {
      const p = fields(["grant_id"]);
      if (typeof p === "string") return malformed(p);
      const grantId = p.grant_id;
      if (typeof grantId !== "string" || !hasOwn(state.grants, grantId)) {
        return malformed(`unknown grant: ${JSON.stringify(grantId)}`);
      }
      ctx.work.patch("grants", grantId, undefined);
      return ok(action);
    }
    default:
      return malformed(
        `unknown engine action: ${action.schema_id}`,
        ".schema_id",
      );
  }
}
