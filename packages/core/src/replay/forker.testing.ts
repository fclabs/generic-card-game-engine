/**
 * Test-only: continues a fork the way a host would, so a test can append a transaction at
 * `n + 1` and re-export the package. Hands off for Iteration 12: `continueFork`.
 */
import type { Result } from "../errors/result.js";
import { err, ok } from "../errors/result.js";
import type { Action } from "../session/actions.js";
import { apply } from "../session/apply/index.js";
import type { Snapshot } from "../session/snapshot.js";
import type { SessionState } from "../session/state.js";
import { stateDigest } from "./canonical/state-schema.js";
import type { ForkResult } from "./forker.js";
import type { ReplayPackage } from "./package.js";
import { replayError } from "./replay-error.js";
import type { ReplayError } from "./replay-error.js";
import type { ResolvedDefinition } from "./resolved-definition.js";

/**
 * Applies `actions` to the fork's state (one new committed transaction at `seq + 1`) and returns
 * the extended package (log and digests grown, `forkedFrom` and `receipts` kept) and new state.
 */
export function continueFork(
  resolved: ResolvedDefinition,
  fork: ForkResult,
  actions: readonly Action[],
  eventId = "evt-fork",
  principal = "host",
): Result<
  { package: ReplayPackage; state: Snapshot<SessionState> },
  ReplayError
> {
  const applied = apply(resolved.definition, fork.state, actions);
  if (!applied.ok) {
    return err(
      replayError(
        "REPLAY_INVALID",
        fork.state.seq + 1,
        `${applied.error.code}: ${applied.error.detail}`,
      ),
    );
  }
  const state = applied.value.state;
  const seq = state.seq;
  return ok({
    state,
    package: {
      ...fork.package,
      log: [
        ...fork.package.log,
        { seq, eventId, principal, actions: applied.value.committed },
      ],
      digests: [
        ...fork.package.digests,
        { seq, digest: stateDigest(resolved.definition, state) },
      ],
    },
  });
}
