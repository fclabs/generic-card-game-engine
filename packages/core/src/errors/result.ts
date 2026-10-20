import type { ErrorCode } from "./codes.js";

/** A failed operation. `actionIndex` is set by `apply` only; `path` names the offending field. */
export interface EngineError {
  code: ErrorCode;
  detail: string;
  actionIndex?: number;
  path?: string;
}

/** A game-defined rejection. The code is opaque to the engine and never an `ErrorCode`. */
export interface GameRejection {
  readonly code: string;
  readonly detail?: string;
}

export type Result<T, E = EngineError> =
  { ok: true; value: T } | { ok: false; error: E };

export function ok<T>(value: T): { ok: true; value: T } {
  return { ok: true, value };
}

export function err<E = EngineError>(error: E): { ok: false; error: E } {
  return { ok: false, error };
}
