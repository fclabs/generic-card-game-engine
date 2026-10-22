/**
 * Test-only: builds a "live" session (states and digests produced by folding `apply` over
 * random legal batches, exactly as a host would) together with the replay package that
 * records it. Replayer tests compare what replay recomputes with what this live run saw.
 * Hands off for Iterations 10-12: `buildLiveSession`, `LiveSession`.
 */
import {
  computeDefinitionId,
  definitionContentHash,
} from "../definition/identity.js";
import type { CompiledGameDefinition } from "../definition/types.js";
import type { StoredSession } from "../ports/types.js";
import type { Action } from "../session/actions.js";
import {
  Tape,
  buildPropertyDefinition,
  generateBatch,
  propertyStart,
} from "../session/generators.testing.js";
import { apply } from "../session/apply/index.js";
import type { Seq } from "../session/ids.js";
import type { Snapshot } from "../session/snapshot.js";
import type { SessionState } from "../session/state.js";
import { stateDigest } from "./canonical/state-schema.js";
import { buildPackage } from "./package.js";
import type { ReplayPackage } from "./package.js";
import type { ResolvedDefinition } from "./resolved-definition.js";

export interface LiveSession {
  readonly definition: CompiledGameDefinition;
  readonly resolved: ResolvedDefinition;
  /** `states[0]` = initial; `states[n]` = state after seq n. */
  readonly states: readonly Snapshot<SessionState>[];
  /** Live `stateDigest` of each state, same indexing as `states`. */
  readonly digests: readonly string[];
  readonly stored: StoredSession;
  /** Recorded with `digests: 'none'`. */
  readonly package: ReplayPackage;
}

export interface LiveSessionOptions {
  /** Number of committed transactions to aim for (attempts are bounded by 4x). */
  readonly transactions: number;
  readonly illegalPercent?: number;
}

/**
 * Plays random batches from a fresh property-definition session until `transactions` batches
 * have committed (failed and empty batches are dropped, as a host would reject them).
 */
export function buildLiveSession(
  tape: readonly number[],
  opts: LiveSessionOptions,
): LiveSession {
  const definition = buildPropertyDefinition();
  const contentHash = definitionContentHash(definition);
  const resolved: ResolvedDefinition = {
    definitionId: computeDefinitionId(contentHash),
    definition,
  };
  const t = new Tape(tape);
  const initial = propertyStart(definition);
  const states: Snapshot<SessionState>[] = [initial];
  const digests: string[] = [stateDigest(definition, initial)];
  const log: {
    seq: Seq;
    eventId: string;
    principal: string;
    actions: readonly Action[];
  }[] = [];
  let state = initial;
  for (
    let attempt = 0;
    attempt < opts.transactions * 4 && log.length < opts.transactions;
    attempt++
  ) {
    const generated = generateBatch(definition, state, t, {
      illegalPercent: opts.illegalPercent ?? 12,
    });
    const applied = apply(definition, state, generated.batch, generated.opts);
    if (!applied.ok || applied.value.committed.length === 0) continue;
    state = applied.value.state;
    states.push(state);
    digests.push(stateDigest(definition, state));
    const seq = state.seq;
    log.push({
      seq,
      eventId: `evt-${String(seq)}`,
      principal: ["host", "alice", "bob"][seq % 3] ?? "host",
      actions: applied.value.committed,
    });
  }
  const stored: StoredSession = {
    sessionId: initial.id,
    definitionId: resolved.definitionId,
    definitionHash: contentHash,
    schemaVersion: definition.schemaVersion,
    initial,
    seq: log.length as Seq,
    log: log.map((tx) => ({ ...tx })),
  };
  const built = buildPackage(stored, [], { resolved, digests: "none" });
  if (!built.ok) throw new Error(built.error.detail);
  return {
    definition,
    resolved,
    states,
    digests,
    stored,
    package: built.value,
  };
}
