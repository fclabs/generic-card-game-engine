import { err, ok } from "../errors/result.js";
import type { Result } from "../errors/result.js";

declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

export type SessionId = Brand<string, "SessionId">;
export type DefinitionId = Brand<string, "DefinitionId">;
export type CardId = Brand<string, "CardId">;
export type ZoneId = Brand<string, "ZoneId">;
export type SeatId = Brand<string, "SeatId">;
export type PlayerId = Brand<string, "PlayerId">;
export type TeamId = Brand<string, "TeamId">;
export type CounterId = Brand<string, "CounterId">;
export type GateId = Brand<string, "GateId">;
export type GrantId = Brand<string, "GrantId">;
/** A non-negative safe integer. */
export type Seq = Brand<number, "Seq">;

/** Spec §6.1: 1–128 characters of `[A-Za-z0-9_.:/-]`. */
const ID_PATTERN = /^[A-Za-z0-9_.:/-]{1,128}$/;

function isIdString(value: unknown): value is string {
  return typeof value === "string" && ID_PATTERN.test(value);
}

function malformed(what: string, value: unknown): Result<never> {
  const shown =
    typeof value === "string"
      ? JSON.stringify(value.length > 40 ? `${value.slice(0, 40)}…` : value)
      : typeof value;
  return err({
    code: "MALFORMED_ACTION",
    detail: `invalid ${what}: ${shown}`,
  });
}

export const isSessionId = (v: unknown): v is SessionId => isIdString(v);
export const isDefinitionId = (v: unknown): v is DefinitionId => isIdString(v);
export const isCardId = (v: unknown): v is CardId => isIdString(v);
export const isZoneId = (v: unknown): v is ZoneId => isIdString(v);
export const isSeatId = (v: unknown): v is SeatId => isIdString(v);
export const isPlayerId = (v: unknown): v is PlayerId => isIdString(v);
export const isTeamId = (v: unknown): v is TeamId => isIdString(v);
export const isCounterId = (v: unknown): v is CounterId => isIdString(v);
export const isGateId = (v: unknown): v is GateId => isIdString(v);
export const isGrantId = (v: unknown): v is GrantId => isIdString(v);
export const isSeq = (v: unknown): v is Seq =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0;

export const sessionId = (v: unknown): Result<SessionId> =>
  isSessionId(v) ? ok(v) : malformed("SessionId", v);
export const definitionId = (v: unknown): Result<DefinitionId> =>
  isDefinitionId(v) ? ok(v) : malformed("DefinitionId", v);
export const cardId = (v: unknown): Result<CardId> =>
  isCardId(v) ? ok(v) : malformed("CardId", v);
export const zoneId = (v: unknown): Result<ZoneId> =>
  isZoneId(v) ? ok(v) : malformed("ZoneId", v);
export const seatId = (v: unknown): Result<SeatId> =>
  isSeatId(v) ? ok(v) : malformed("SeatId", v);
export const playerId = (v: unknown): Result<PlayerId> =>
  isPlayerId(v) ? ok(v) : malformed("PlayerId", v);
export const teamId = (v: unknown): Result<TeamId> =>
  isTeamId(v) ? ok(v) : malformed("TeamId", v);
export const counterId = (v: unknown): Result<CounterId> =>
  isCounterId(v) ? ok(v) : malformed("CounterId", v);
export const gateId = (v: unknown): Result<GateId> =>
  isGateId(v) ? ok(v) : malformed("GateId", v);
export const grantId = (v: unknown): Result<GrantId> =>
  isGrantId(v) ? ok(v) : malformed("GrantId", v);
export const seq = (v: unknown): Result<Seq> =>
  isSeq(v) ? ok(v) : malformed("Seq", v);
