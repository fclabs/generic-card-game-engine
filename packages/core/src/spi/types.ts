import type { GameRejection } from "../errors/result.js";
import type { ErrorCode } from "../errors/codes.js";
import type {
  Action,
  GateMaskedSnapshot,
  Macro,
  SeatId,
  SealedBySeat,
  SessionId,
} from "../session/index.js";

/**
 * The rule SPI (spec KFR-090, architecture A4). Types only: this module has no runtime
 * code (KFR-091). `Reducer`, `Action`, `Macro`, `GateMaskedSnapshot` and `SealedBySeat`
 * live in `session` and are re-exported from `./index.ts`.
 */

/**
 * Core-owned structural stand-in for the host cancellation signal, because core compiles
 * with `types: []`. The host's own signal type is assignable to it (KFR-090).
 */
export interface AbortSignalLike {
  readonly aborted: boolean;
  addEventListener(type: "abort", listener: () => void): void;
  removeEventListener(type: "abort", listener: () => void): void;
}

/** A hook's verdict on a proposal: it may go ahead. */
export interface Accept {
  readonly accepted: true;
}

/** A hook's verdict on a proposal: a game-defined rejection with an opaque code. */
export interface Reject {
  readonly accepted: false;
  readonly rejection: GameRejection;
}

/** Authorization verdict: the principal may perform the operation. */
export interface Allow {
  readonly allowed: true;
}

/** Authorization verdict: refused, with the engine error code that explains why. */
export interface Deny {
  readonly allowed: false;
  readonly code: ErrorCode;
  readonly detail?: string;
}

/**
 * An effect requested by a reaction hook. Effects are not logged and not state: `apply`
 * never reads them (KBR-013). `duration_hint` is a host hint in milliseconds.
 */
export type Effect = {
  readonly type: "timer_request";
  readonly id: string;
  readonly kind: string;
  readonly duration_hint: number;
};

/** A player or control proposal of kind `K` (the routing key of validation hooks). */
export interface Proposal<K extends string = string> {
  readonly kind: K;
  readonly payload: unknown;
}

export interface ValidationContext<K extends string = string> {
  readonly snapshot: GateMaskedSnapshot;
  readonly proposal: Proposal<K>;
  readonly actor: {
    readonly actingSeat: SeatId;
    readonly onBehalfOf?: SeatId;
  };
  readonly signal: AbortSignalLike;
}

export interface ReactionContext {
  readonly snapshot: GateMaskedSnapshot;
  readonly committed: readonly Action[];
  readonly signal: AbortSignalLike;
}

export interface ReactionResult {
  readonly actions: readonly (Action | Macro)[];
  readonly effects: readonly Effect[];
}

export interface GateResolveContext {
  readonly sealed: SealedBySeat;
  readonly missing: readonly SeatId[];
}

export type ValidationHook<K extends string = string> = (
  ctx: ValidationContext<K>,
) => Promise<Accept | Reject>;

export type ReactionHook = (ctx: ReactionContext) => Promise<ReactionResult>;

export type GateResolveHook = (
  ctx: GateResolveContext,
) => Promise<readonly (Action | Macro)[]>;

/** Opaque identity of the caller, as authenticated by the host. */
export type Principal = string;

/** Operation union of KFR-112. */
export type AuthOp =
  | `propose:${string}`
  | `query:${string}`
  | `subscribe:${string}`
  | "export"
  | "direct_apply"
  | "fork";

/** What an operation is aimed at. */
export interface AuthTarget {
  readonly sessionId: SessionId;
  readonly seat?: SeatId;
}

export type AuthorizationHook = (
  principal: Principal,
  op: AuthOp,
  target: AuthTarget,
) => Promise<Allow | Deny>;
