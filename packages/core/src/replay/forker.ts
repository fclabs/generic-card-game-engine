import { err, ok } from "../errors/result.js";
import type { Result } from "../errors/result.js";
import { isSessionId } from "../session/ids.js";
import type { SessionId, Seq } from "../session/ids.js";
import { deepFreeze } from "../session/snapshot.js";
import type { Snapshot } from "../session/snapshot.js";
import type { SessionState } from "../session/state.js";
import type { ReplayPackage } from "./package.js";
import { replayError } from "./replay-error.js";
import type { ReplayError } from "./replay-error.js";
import type { ResolvedDefinition } from "./resolved-definition.js";
import { replayer as defaultReplayer } from "./replayer.js";
import type { Replayer } from "./replayer.js";

/** A fork: a new package for `sessionId` and the state at the fork point (PFR-054). */
export interface ForkResult {
  /** Deep-frozen; shares no object with the source package. */
  readonly package: ReplayPackage;
  /** The state at `n`, with the fork's session id; deep-frozen. */
  readonly state: Snapshot<SessionState>;
}

/** Deep copy of plain data (objects, arrays, primitives incl. `bigint`); own data properties only. */
function copy<T>(value: T): T {
  if (Array.isArray(value)) {
    return (value as unknown[]).map(copy) as T;
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, copy(v)]),
    ) as T;
  }
  return value;
}

/**
 * Forks `pkg` at `n` into a new session (PFR-054..056): same `initial` (re-keyed to the new id),
 * `params` and definition binding, `log` and `digests` cut to `seq <= n`, no receipts and
 * `forkedFrom = {sessionId: pkg.sessionId, seq: n}`. The fork is verified by replaying it
 * (`replayer.rebuild` up to `n`, against the recorded digests), so a tampered source fails with
 * the replayer's error. The source is never touched: the result shares no object with it, and
 * it is deep-frozen so the fork cannot be mutated through either side (PFR-055). The state's
 * digest equals the source's at `n` because the digest excludes the session id (PBR-009).
 * Invalid `n` (outside `0..log.length`, not an integer) or session id (not a valid id, or the
 * source's own) is `REPLAY_INVALID` at seq 0.
 */
export function forkFromSeq(
  resolved: ResolvedDefinition,
  pkg: ReplayPackage,
  n: number,
  target: { readonly sessionId: string },
  replayer: Replayer = defaultReplayer,
): Result<ForkResult, ReplayError> {
  const invalid = (detail: string) =>
    err(replayError("REPLAY_INVALID", 0, detail));
  if (!isSessionId(target.sessionId)) return invalid("invalid session id");
  if (target.sessionId === pkg.sessionId) return invalid("same session id");
  const last = pkg.log.length;
  if (!Number.isInteger(n) || n < 0 || n > last) {
    return invalid(
      `fork seq out of range: ${String(n)} (the log ends at seq ${String(last)})`,
    );
  }
  const id: SessionId = target.sessionId;
  const forked: ReplayPackage = {
    formatVersion: pkg.formatVersion,
    sessionId: id,
    definition: copy(pkg.definition),
    actionSchemaVersion: pkg.actionSchemaVersion,
    initial: { ...copy(pkg.initial), id },
    params: copy(pkg.params),
    log: copy(pkg.log.slice(0, n)),
    receipts: [],
    digests: copy(pkg.digests.filter((d) => d.seq <= n)),
    forkedFrom: { sessionId: pkg.sessionId, seq: n as Seq },
  };
  deepFreeze(forked);
  const rebuilt = replayer.rebuild(resolved, forked);
  if (!rebuilt.ok) return rebuilt;
  return ok({ package: forked, state: rebuilt.value.state });
}
