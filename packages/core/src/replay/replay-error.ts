import type { EngineError } from "../errors/result.js";
import type { Seq } from "../session/ids.js";

/**
 * Failure of replay, export or fork (spec §7.4): an `EngineError` restricted to the two replay
 * codes, carrying the `seq` it concerns (`0` for binding and initial-state problems). The
 * `detail` is operator-facing (PBR-008): it may name card, zone and counter ids but never
 * hidden metadata or sealed payloads.
 */
export interface ReplayError extends EngineError {
  code: "REPLAY_INVALID" | "REPLAY_MISMATCH";
  seq: Seq;
}

export function replayError(
  code: ReplayError["code"],
  seq: number,
  detail: string,
  extra: { actionIndex?: number; path?: string } = {},
): ReplayError {
  const error: ReplayError = { code, detail, seq: seq as Seq };
  if (extra.actionIndex !== undefined) error.actionIndex = extra.actionIndex;
  if (extra.path !== undefined) error.path = extra.path;
  return error;
}
