import type {
  CardId,
  CounterId,
  GateId,
  GrantId,
  PlayerId,
  SeatId,
  SessionId,
  TeamId,
  ZoneId,
} from "./ids.js";
import type { Seq } from "./ids.js";
import type { Snapshot } from "./snapshot.js";

/** Canonical-JSON-compatible value (spec §6.2 `json` node): no floats, `bigint` or `undefined`. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export type Lifecycle = "active" | "completed" | "terminated";
export type Orientation = "face_up" | "face_down";
export type SeatStatus = "seated" | "sitting_out" | "eliminated";

export interface CardState {
  readonly zone: ZoneId;
  readonly orientation: Orientation;
  readonly metadata: Readonly<Record<string, JsonValue>>;
}

export interface ZoneState {
  readonly template?: string;
  /** Absent for `none`-rule templates and for configured (non-template) zones. */
  readonly owner?: SeatId | TeamId | PlayerId;
  readonly members: readonly CardId[];
}

export interface RosterSeat {
  readonly status: SeatStatus;
  readonly player?: PlayerId;
  readonly team?: TeamId;
}

export interface RosterState {
  readonly seats: Readonly<Record<SeatId, RosterSeat>>;
}

export interface ControlState {
  readonly phase: string;
  readonly turnOrder: readonly SeatId[];
  readonly activeSeats: readonly SeatId[];
  readonly direction: 1 | -1;
  readonly pointers: Readonly<Record<string, SeatId>>;
}

export interface Gate {
  readonly schemaId: string;
  readonly expectedSeats: readonly SeatId[];
  readonly submissions: Readonly<Record<SeatId, JsonValue>>;
}

export interface ResolvedGate {
  readonly schemaId: string;
  readonly expectedSeats: readonly SeatId[];
  readonly submissions: Readonly<Record<SeatId, JsonValue>>;
}

export interface Delegation {
  readonly seat: SeatId;
  readonly principal: string;
  readonly scope?: JsonValue;
  readonly boundary?: string;
}

export interface Grant {
  /** KFR-040 target shapes. */
  readonly target: JsonValue;
  readonly keys: readonly string[];
  readonly grantee: string;
  /** KFR-040 scope shapes. */
  readonly scope: JsonValue;
}

/** Opaque canonical JSON (a `json` node). */
export type GameOutcome = JsonValue;

export interface GatesState {
  readonly open: Readonly<Record<GateId, Gate>>;
  readonly resolved: Readonly<Record<GateId, ResolvedGate>>;
}

/**
 * Session state (spec §6.4). Always deep-frozen when it leaves the kernel.
 * Digest field order = declaration order below, `id` excluded, with the computed
 * `derivedCounters` emitted right after `counters` (never stored).
 */
export interface SessionState {
  readonly id: SessionId;
  readonly lifecycle: Lifecycle;
  readonly seq: Seq;
  readonly cards: Readonly<Record<CardId, CardState>>;
  readonly zones: Readonly<Record<ZoneId, ZoneState>>;
  /** Key `<template>/<ownerToken>`. */
  readonly zoneOrdinals: Readonly<Record<string, number>>;
  /** Stored counters only. */
  readonly counters: Readonly<Record<CounterId, bigint>>;
  /** Key = `schema_id`. */
  readonly meta: Readonly<Record<string, JsonValue>>;
  readonly roster: RosterState;
  readonly control: ControlState;
  readonly gates: GatesState;
  readonly delegations: readonly Delegation[];
  readonly grants: Readonly<Record<GrantId, Grant>>;
  readonly outcome?: GameOutcome;
}

/** Input of `createSession` (KFR-010). */
export interface RosterEntry {
  readonly seat: SeatId;
  readonly player?: PlayerId;
  readonly team?: TeamId;
}

export interface MaskedGate {
  readonly schemaId: string;
  readonly expectedSeats: readonly SeatId[];
  readonly submitted: readonly SeatId[];
}

/** The `submitted` list of a masked gate: seats (in `expectedSeats` order) that hold a submission. */
export type SealedBySeat = readonly SeatId[];

export type GateMaskedSnapshot = Snapshot<
  Omit<SessionState, "gates"> & {
    readonly gates: {
      readonly open: Readonly<Record<GateId, MaskedGate>>;
      readonly resolved: Readonly<Record<GateId, ResolvedGate>>;
    };
  }
>;

/** Notification that a `lifecycle` action ended the session (KFR-027). */
export interface SessionEnded {
  readonly to: "completed" | "terminated";
  readonly outcome?: GameOutcome;
}
