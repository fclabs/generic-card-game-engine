/**
 * Source of truth for `golden-package.json` (test-only; pure, no I/O) and the fixture session
 * that Phase 3 replay tests reuse (Replayer, Forker, upgraders).
 *
 * The session is the P1 property definition (`goldenDefinition()`, code-built, with bound
 * reducers) played from `createSession` through twelve transactions: the first eleven batches
 * of the P1 golden stream (macros, flips, metadata, a literal shuffle, counters with ratios,
 * control, three grants, a revoke, an expiry, delegations, template zones, meta partitions and
 * two sealed gates) and a twelfth that merges a pile and completes the game with an outcome.
 * Together they commit every primitive kind. Every transaction has an event id and a principal;
 * each has a receipt, plus one rejected-event receipt.
 *
 * Regenerate: `UPDATE_GOLDEN=1 pnpm exec vitest run packages/core/src/replay/package.test.ts`.
 * The committed file is the package's canonical bytes (no trailing newline, one line).
 */
import { definitionContentHash } from "../definition/identity.js";
import { computeDefinitionId } from "../definition/identity.js";
import type { CompiledGameDefinition } from "../definition/types.js";
import type { Receipt, StoredSession } from "../ports/types.js";
import { A } from "../session/actions.testing.js";
import type { Action } from "../session/actions.js";
import { apply } from "../session/apply/index.js";
import { createSession } from "../session/create.js";
import {
  GOLDEN_STEPS,
  goldenDefinition,
  goldenRoster,
} from "../session/golden-stream.testing.js";
import type { GoldenStep } from "../session/golden-stream.testing.js";
import { sessionId } from "../session/ids.js";
import type { Seq } from "../session/ids.js";
import type { Snapshot } from "../session/snapshot.js";
import type { SessionState } from "../session/state.js";
import { encodeUtf8 } from "../util/utf8.js";
import { sha256Hex } from "./canonical/sha256.js";
import { encodePackage, buildPackage } from "./package.js";
import type { PackageReceipt, ReplayPackage } from "./package.js";
import type { ResolvedDefinition } from "./resolved-definition.js";

export const GOLDEN_PACKAGE_SESSION_ID = "golden-pkg-1";

/** The twelve batches: golden stream steps 1..11 and step 12 followed by the completing action. */
export function goldenPackageSteps(): readonly GoldenStep[] {
  const twelfth = GOLDEN_STEPS[11];
  if (twelfth === undefined) throw new Error("golden stream has no step 12");
  return [
    ...GOLDEN_STEPS.slice(0, 11),
    {
      ...twelfth,
      batch: [
        ...twelfth.batch,
        A.lifecycle("completed", { winner: "s1", scores: { s1: 10, s2: 3 } }),
      ],
    },
  ];
}

const PRINCIPALS = ["host", "alice", "bob"] as const;

export interface GoldenPackageSession {
  readonly definition: CompiledGameDefinition;
  readonly resolved: ResolvedDefinition;
  readonly stored: StoredSession;
  /** Deliberately not sorted (reverse insertion order); `buildPackage` sorts them. */
  readonly receipts: readonly PackageReceipt[];
  /** The state after each seq, `states[0]` = initial. */
  readonly states: readonly Snapshot<SessionState>[];
  /** `buildPackage(stored, receipts, {digests: 'every'})`, the committed golden package. */
  readonly package: ReplayPackage;
}

function fingerprint(text: string): string {
  const bytes = encodeUtf8(text);
  if (!bytes.ok) throw new Error("lone surrogate");
  return sha256Hex(bytes.value);
}

function must<T>(
  r: { ok: true; value: T } | { ok: false; error: { detail: string } },
): T {
  if (!r.ok) throw new Error(r.error.detail);
  return r.value;
}

export function buildGoldenPackageSession(): GoldenPackageSession {
  const definition = goldenDefinition();
  const contentHash = definitionContentHash(definition);
  const resolved: ResolvedDefinition = {
    definitionId: computeDefinitionId(contentHash),
    definition,
  };
  const id = must(sessionId(GOLDEN_PACKAGE_SESSION_ID));
  const initial = must(createSession(definition, id, goldenRoster()));
  const states: Snapshot<SessionState>[] = [initial];
  const log: {
    seq: Seq;
    eventId: string;
    principal: string;
    actions: readonly Action[];
  }[] = [];
  const receipts: PackageReceipt[] = [];
  const steps = goldenPackageSteps();
  steps.forEach((step, i) => {
    const before = states[i];
    if (before === undefined) throw new Error("missing state");
    const applied = must(apply(definition, before, step.batch, step.opts));
    states.push(applied.state);
    const seq = (i + 1) as Seq;
    const eventId = `evt-${String(seq).padStart(2, "0")}`;
    const principal = PRINCIPALS[i % PRINCIPALS.length] ?? "host";
    log.push({ seq, eventId, principal, actions: applied.committed });
    const receipt: Receipt = {
      fingerprint: fingerprint(`${principal}/${eventId}`),
      result: { seq },
      errorCode: null,
      seq,
      detail: null,
      privileged: false,
    };
    receipts.push({ principal, eventId, receipt });
  });
  receipts.push({
    principal: "bob",
    eventId: "evt-rejected",
    receipt: {
      fingerprint: fingerprint("bob/evt-rejected"),
      result: null,
      errorCode: "MALFORMED_ACTION",
      seq: null,
      detail: { path: "$[0]" },
      privileged: true,
    },
  });
  receipts.reverse();

  const stored: StoredSession = {
    sessionId: id,
    definitionId: resolved.definitionId,
    definitionHash: contentHash,
    schemaVersion: definition.schemaVersion,
    initial,
    seq: log.length as Seq,
    log: log.map((tx) => ({ ...tx })),
  };
  const built = buildPackage(stored, receipts, {
    resolved,
    digests: "every",
    params: { seed: "golden-seed-1", game: "property" },
  });
  if (!built.ok) throw new Error(built.error.detail);
  return {
    definition,
    resolved,
    stored,
    receipts,
    states,
    package: built.value,
  };
}

export function buildGoldenPackageBytes(): Uint8Array {
  return encodePackage(buildGoldenPackageSession().package);
}
