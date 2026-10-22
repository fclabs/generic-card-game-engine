/**
 * Test-only: the end-to-end trick-taking session of Iteration 12 (VC-378). A four-seat game
 * played live through `apply`: a sealed gate, a `once` grant consumed through `wouldReveal` +
 * `engine.grant_consume`, ten trick cycles with shuffles and counter transfers, and a
 * lifecycle end (more than 60 transactions). Every secret in the data is a canary
 * (`zq<letters><n>x` strings, 7-digit counters) so the no-leak checks of the visibility
 * properties apply to it unchanged. Hands off: `buildTrickSession`, `TrickSession`, `VIEWERS`.
 */
import {
  computeDefinitionId,
  definitionContentHash,
} from "../definition/identity.js";
import type { CompiledGameDefinition } from "../definition/types.js";
import type { StoredSession, Transaction } from "../ports/types.js";
import { A } from "../session/actions.testing.js";
import type { Action } from "../session/actions.js";
import { must } from "../session/apply/apply.testing.js";
import { apply } from "../session/apply/index.js";
import { engine } from "../session/apply/reducers.testing.js";
import type { Seq } from "../session/ids.js";
import type { Snapshot } from "../session/snapshot.js";
import type { SessionState } from "../session/state.js";
import {
  buildTrickTakingDefinition,
  TRICK_SEATS,
} from "../visibility/fixtures.testing.js";
import type { CaseStep } from "../visibility/generators.testing.js";
import { sealBatch } from "../visibility/privileged-batch.js";
import { projectDelta } from "../visibility/project-delta.js";
import { projectView } from "../visibility/project-view.js";
import type { ViewerIdentity } from "../visibility/types.js";
import { roleState, seat } from "../visibility/visibility.testing.js";
import { wouldReveal } from "../visibility/would-reveal.js";
import { stateDigest } from "./canonical/state-schema.js";
import { buildPackage } from "./package.js";
import type { ReplayPackage } from "./package.js";
import type { ResolvedDefinition } from "./resolved-definition.js";

const VIEW_KEYS = ["card_face", "zone_membership", "zone_count", "zone_order"];

/** The viewers whose views and deltas the scenario stores at every seq. */
export const VIEWERS: readonly ViewerIdentity[] = [
  ...TRICK_SEATS.map((s) => ({ role: "player", subject: seat(s) })),
  { role: "render" },
  { role: "render", subject: seat("north") },
  { role: "auditor" },
  { role: "dealer" },
];

export const viewerLabel = (v: ViewerIdentity): string =>
  `${v.role}${v.subject === undefined ? "" : `@${v.subject}`}`;

/** Trick-taking definition with canary data and a registered auditor (hands) and dealer (stock). */
export function buildTrickSessionDefinition(): CompiledGameDefinition {
  const base = buildTrickTakingDefinition({ viewKeys: VIEW_KEYS });
  let n = 0;
  return {
    ...base,
    cards: base.cards.map((c, i) => ({
      ...c,
      initialMetadata: {
        suit: "hearts",
        own: 7,
        key: `zqsecret${String(i)}x`,
        extra: `zqextra${String(i)}x`,
      },
    })),
    zones: base.zones.map((z) =>
      z.id.startsWith("hand-")
        ? { ...z, visibility: { ...z.visibility, auditor: "public" as const } }
        : z.id === "stock"
          ? { ...z, visibility: { ...z.visibility, dealer: "public" as const } }
          : z,
    ),
    counters: base.counters.map((c) =>
      c.id.startsWith("chips-") ? { ...c, initial: 5000000n + BigInt(++n) } : c,
    ),
  };
}

export interface TrickSession {
  readonly def: CompiledGameDefinition;
  readonly resolved: ResolvedDefinition;
  /** `states[0]` is the initial state, `states[n]` the state after seq n. */
  readonly states: readonly Snapshot<SessionState>[];
  readonly steps: readonly CaseStep[];
  /** Live `stateDigest` per state (same indexing as `states`). */
  readonly digests: readonly string[];
  /** `views[seq][viewer]`, JSON of the live `projectView` (seq 0 = initial state). */
  readonly views: readonly (readonly string[])[];
  /** `deltas[seq][viewer]`, JSON of the live `projectDelta` (index 0 is unused: `""`). */
  readonly deltas: readonly (readonly string[])[];
  /** Grants the projector flagged and the session consumed (one `once` grant). */
  readonly consumed: readonly string[];
  readonly stored: StoredSession;
  /** Built with `digests: 'every'`. */
  readonly package: ReplayPackage;
  /** Every canary string of the data (card metadata, gate payloads, counter values). */
  readonly secrets: readonly string[];
}

const json = (value: unknown): string => JSON.stringify(value);

export function buildTrickSession(): TrickSession {
  const def = buildTrickSessionDefinition();
  const contentHash = definitionContentHash(def);
  const resolved: ResolvedDefinition = {
    definitionId: computeDefinitionId(contentHash),
    definition: def,
  };
  const initial = roleState(def);
  const states: Snapshot<SessionState>[] = [initial];
  const steps: CaseStep[] = [];
  const digests: string[] = [stateDigest(def, initial)];
  const viewsOf = (state: Snapshot<SessionState>): string[] =>
    VIEWERS.map((v) => json(must(projectView(def, state, v))));
  const views: string[][] = [viewsOf(initial)];
  const deltas: string[][] = [[]];
  const consumed: string[] = [];
  const secrets: string[] = [];
  let state = initial;

  const commit = (build: (st: Snapshot<SessionState>) => Action[]): void => {
    const actions = build(state);
    const seq = (state.seq + 1) as Seq;
    const tx = (committed: readonly Action[]): Transaction => ({
      seq,
      eventId: `evt-${String(seq)}`,
      principal: ["host", "alice", "bob"][seq % 3] ?? "host",
      actions: committed,
    });
    let applied = must(apply(def, state, actions));
    // Grant consumption (A4): ask the projector which once grants this batch reveals, then
    // commit the consume actions in the same transaction.
    const reveals = wouldReveal(
      def,
      state,
      applied.state,
      sealBatch(tx(applied.committed)),
    );
    if (reveals.length > 0) {
      consumed.push(...reveals);
      applied = must(
        apply(def, state, [
          ...actions,
          ...reveals.map((id) => engine("grant_consume", { grant_id: id })),
        ]),
      );
    }
    const transaction = tx(applied.committed);
    const batch = sealBatch(transaction);
    const post = applied.state;
    steps.push({ pre: state, post, batch, tx: transaction });
    states.push(post);
    digests.push(stateDigest(def, post));
    views.push(viewsOf(post));
    deltas.push(
      VIEWERS.map((v) => json(must(projectDelta(def, state, post, batch, v)))),
    );
    state = post;
  };

  const handCard = (st: Snapshot<SessionState>, s: string): string =>
    String(st.zones[`hand-${s}` as never]?.members[0]);

  // Setup: reveal two table cards, a once grant of north's hand to east, a temporary
  // grant, and the sealed passing gate (all four seats submit, then it resolves).
  commit(() => [A.flip("t1", "face_up"), A.flip("d1", "face_up")]);
  commit(() => [
    A.grant({ kind: "zone", zone_id: "hand-north" }, VIEW_KEYS, "east", {
      kind: "once",
    }),
    A.grant({ kind: "zone", zone_id: "stock" }, ["zone_count"], "west", {
      kind: "until_seq",
      n: 40,
    }),
  ]);
  commit(() => [
    engine("gate_open", {
      gate_id: "pass",
      schema_id: "pass_cards",
      expected_seats: [...TRICK_SEATS],
    }),
  ]);
  TRICK_SEATS.forEach((s, i) => {
    const payload = `zqgate${String(i)}x`;
    secrets.push(payload);
    commit(() => [
      engine("gate_submit", { gate_id: "pass", seat: s, payload }),
    ]);
  });
  commit(() => [engine("gate_resolve", { gate_id: "pass" })]);

  // Ten trick cycles: four plays, the winner collects, the cards return to the hands.
  for (let cycle = 0; cycle < 10; cycle++) {
    const played: string[] = [];
    for (const s of TRICK_SEATS) {
      commit((st) => {
        const card = handCard(st, s);
        played.push(card);
        return [
          A.move(card, `hand-${s}`, "trick", 0),
          A.flip(card, "face_up"),
          A.advance(1),
        ];
      });
    }
    const winner = TRICK_SEATS[cycle % 4] ?? "north";
    commit(() => [
      ...played.map((card) => A.move(card, "trick", "discard", 0)),
      A.transfer(`chips-${winner}`, "pot", 1n),
    ]);
    commit((st) => [
      ...played.map((card, i) =>
        A.move(card, "discard", `hand-${TRICK_SEATS[i] ?? "north"}`),
      ),
      ...played.map((card) => A.flip(card, "face_down")),
      ...(cycle % 3 === 0
        ? [
            A.shuffle(
              "stock",
              [...(st.zones["stock" as never]?.members ?? [])].reverse(),
            ),
          ]
        : []),
    ]);
  }
  commit(() => [A.lifecycle("completed", { winner: "north" })]);

  for (const c of Object.values(initial.cards)) {
    for (const v of Object.values(c.metadata)) {
      if (typeof v === "string" && v.startsWith("zq")) secrets.push(v);
    }
  }
  for (const v of Object.values(initial.counters)) {
    if (v >= 1000000n) secrets.push(v.toString());
  }

  const stored: StoredSession = {
    sessionId: initial.id,
    definitionId: resolved.definitionId,
    definitionHash: contentHash,
    schemaVersion: def.schemaVersion,
    initial,
    seq: steps.length as Seq,
    log: steps.map((s) => ({ ...s.tx, seq: s.tx.seq as Seq })),
  };
  const built = buildPackage(stored, [], { resolved, digests: "every" });
  if (!built.ok) throw new Error(built.error.detail);
  return {
    def,
    resolved,
    states,
    steps,
    digests,
    views,
    deltas,
    consumed,
    stored,
    package: built.value,
    secrets,
  };
}
