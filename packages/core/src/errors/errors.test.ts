import { describe, expect, expectTypeOf, it } from "vitest";
import { ERROR_CODES, err, ok } from "./index.js";
import type { EngineError, ErrorCode, GameRejection, Result } from "./index.js";

const EXPECTED: readonly string[] = [
  "IDEMPOTENCY_CONFLICT",
  "STALE",
  "STALE_WRITER",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "UNKNOWN_ROLE",
  "UNKNOWN_SUBJECT",
  "SUBJECT_NOT_ALLOWED",
  "VIEW_DENIED",
  "NOT_YOUR_TURN",
  "NOT_READY",
  "GATE_CLOSED",
  "CARD_NOT_IN_ZONE",
  "EMPTY_ZONE",
  "COUNTER_BOUNDS",
  "ZONE_LIMIT",
  "REDUCER_ERROR",
  "MALFORMED_ACTION",
  "SESSION_ENDED",
  "REPLAY_INVALID",
  "REPLAY_MISMATCH",
  "HOOK_ERROR",
  "HOOK_TIMEOUT",
  "CASCADE_LIMIT",
];

/** Compile-time exhaustiveness: adding or removing a code breaks this switch. */
function describeCode(code: ErrorCode): string {
  switch (code) {
    case "IDEMPOTENCY_CONFLICT":
    case "STALE":
    case "STALE_WRITER":
    case "UNAUTHORIZED":
    case "FORBIDDEN":
    case "UNKNOWN_ROLE":
    case "UNKNOWN_SUBJECT":
    case "SUBJECT_NOT_ALLOWED":
    case "VIEW_DENIED":
    case "NOT_YOUR_TURN":
    case "NOT_READY":
    case "GATE_CLOSED":
    case "CARD_NOT_IN_ZONE":
    case "EMPTY_ZONE":
    case "COUNTER_BOUNDS":
    case "ZONE_LIMIT":
    case "REDUCER_ERROR":
    case "MALFORMED_ACTION":
    case "SESSION_ENDED":
    case "REPLAY_INVALID":
    case "REPLAY_MISMATCH":
    case "HOOK_ERROR":
    case "HOOK_TIMEOUT":
    case "CASCADE_LIMIT":
      return code;
    default: {
      const unreachable: never = code;
      return unreachable;
    }
  }
}

describe("VC-003 error taxonomy", () => {
  it("ERROR_CODES is exactly the 24 codes of KFR-002", () => {
    expect(ERROR_CODES).toHaveLength(24);
    expect(new Set(ERROR_CODES).size).toBe(24);
    expect([...ERROR_CODES].sort()).toEqual([...EXPECTED].sort());
  });
  it("the exhaustive switch handles every runtime code", () => {
    expect(ERROR_CODES.map(describeCode)).toEqual([...ERROR_CODES]);
  });
  it("ErrorCode is the union of the runtime list", () => {
    expectTypeOf<ErrorCode>().toEqualTypeOf<(typeof ERROR_CODES)[number]>();
  });
});

describe("Result, ok, err", () => {
  it("ok and err build the two variants", () => {
    const good: Result<number> = ok(1);
    const e: EngineError = { code: "EMPTY_ZONE", detail: "z", actionIndex: 2 };
    const bad: Result<number> = err(e);
    expect(good).toEqual({ ok: true, value: 1 });
    expect(bad).toEqual({ ok: false, error: e });
  });
  it("EngineError optional fields may be omitted; GameRejection code is opaque", () => {
    const e: EngineError = { code: "STALE", detail: "d" };
    expect(e.actionIndex).toBeUndefined();
    const r: GameRejection = { code: "my_game.rule" };
    expectTypeOf(r.code).toBeString();
    // @ts-expect-error a GameRejection is not an EngineError
    const notEngine: EngineError = r;
    expect(notEngine).toBe(r);
  });
});
