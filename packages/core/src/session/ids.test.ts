import { describe, expect, expectTypeOf, it } from "vitest";
import {
  cardId,
  counterId,
  definitionId,
  gateId,
  grantId,
  isCardId,
  isCounterId,
  isDefinitionId,
  isGateId,
  isGrantId,
  isPlayerId,
  isSeatId,
  isSeq,
  isSessionId,
  isTeamId,
  isZoneId,
  playerId,
  seatId,
  seq,
  sessionId,
  teamId,
  zoneId,
} from "./ids.js";
import type { CardId, Seq, ZoneId } from "./ids.js";

const stringIds = [
  ["SessionId", isSessionId, sessionId],
  ["DefinitionId", isDefinitionId, definitionId],
  ["CardId", isCardId, cardId],
  ["ZoneId", isZoneId, zoneId],
  ["SeatId", isSeatId, seatId],
  ["PlayerId", isPlayerId, playerId],
  ["TeamId", isTeamId, teamId],
  ["CounterId", isCounterId, counterId],
  ["GateId", isGateId, gateId],
  ["GrantId", isGrantId, grantId],
] as const;

describe("VC-001 string id guards", () => {
  for (const [name, guard, make] of stringIds) {
    describe(name, () => {
      it("rejects the empty string", () => {
        expect(guard("")).toBe(false);
      });
      it("rejects a 129-char string and accepts 128", () => {
        expect(guard("a".repeat(129))).toBe(false);
        expect(guard("a".repeat(128))).toBe(true);
      });
      it("rejects a string with a space or other illegal character", () => {
        expect(guard("seat 1")).toBe(false);
        expect(guard("seat#1")).toBe(false);
        expect(guard("seat\n1")).toBe(false);
        expect(guard("é")).toBe(false);
      });
      it("accepts seat-1 and the full charset", () => {
        expect(guard("seat-1")).toBe(true);
        expect(guard("A_b.c:d/e-9")).toBe(true);
      });
      it("rejects non-strings", () => {
        expect(guard(1)).toBe(false);
        expect(guard(undefined)).toBe(false);
        expect(guard(null)).toBe(false);
        expect(guard({})).toBe(false);
      });
      it("constructor returns ok / MALFORMED_ACTION", () => {
        expect(make("seat-1")).toEqual({ ok: true, value: "seat-1" });
        const bad = make("");
        expect(bad.ok).toBe(false);
        if (!bad.ok) {
          expect(bad.error.code).toBe("MALFORMED_ACTION");
          expect(bad.error.detail).toContain(name);
        }
      });
    });
  }
});

describe("VC-001 Seq guard", () => {
  it("accepts 0 and MAX_SAFE_INTEGER", () => {
    expect(isSeq(0)).toBe(true);
    expect(isSeq(Number.MAX_SAFE_INTEGER)).toBe(true);
  });
  it("rejects -1, 1.5, 2**53, '1', NaN, -0 is accepted as 0", () => {
    expect(isSeq(-1)).toBe(false);
    expect(isSeq(1.5)).toBe(false);
    expect(isSeq(2 ** 53)).toBe(false);
    expect(isSeq("1")).toBe(false);
    expect(isSeq(Number.NaN)).toBe(false);
    expect(isSeq(1n)).toBe(false);
  });
  it("constructor returns Result", () => {
    expect(seq(3)).toEqual({ ok: true, value: 3 });
    const bad = seq(-1);
    expect(bad.ok).toBe(false);
  });
});

describe("VC-002 brands are not interchangeable", () => {
  it("CardId is not assignable to ZoneId", () => {
    expectTypeOf<CardId>().not.toExtend<ZoneId>();
    expectTypeOf<ZoneId>().not.toExtend<CardId>();
    expectTypeOf<Seq>().not.toEqualTypeOf<number>();
    const c = "c1" as CardId;
    // @ts-expect-error a CardId cannot stand in for a ZoneId
    const z: ZoneId = c;
    expect(z).toBe("c1");
  });
  it("a plain string is not a CardId", () => {
    // @ts-expect-error unbranded string
    const c: CardId = "c1";
    expect(c).toBe("c1");
  });
});
