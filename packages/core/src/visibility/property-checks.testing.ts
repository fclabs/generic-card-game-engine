import type { CompiledGameDefinition } from "../definition/types.js";
import { stateDigest } from "../replay/canonical/index.js";
import { apply } from "../session/apply/index.js";
import { isDeepFrozen } from "../session/snapshot.testing.js";
import { cloneData, variant } from "../session/state.testing.js";
import type { Mutable } from "../session/state.testing.js";
import type { Snapshot } from "../session/snapshot.js";
import type { SessionState } from "../session/state.js";
import { seatId } from "../session/ids.js";
import type { SeatId } from "../session/ids.js";
import type { CaseStep, RoleClass } from "./generators.testing.js";
import { tokensOf, viewersOf } from "./generators.testing.js";
import { foldDelta } from "./delta-fold.testing.js";
import type { FoldedView } from "./delta-fold.testing.js";
import {
  diffFacts,
  expectedViewerError,
  oracleCardFaces,
  oracleFacts,
  viewFacts,
} from "./oracle.testing.js";
import type { Facts, ViewLike } from "./oracle.testing.js";
import { projectDelta, projectLogEntry } from "./project-delta.js";
import { projectView } from "./project-view.js";
import type { ViewerIdentity } from "./types.js";
import { sealBatch } from "./privileged-batch.js";

/**
 * The check functions behind the Phase 3 properties (VC-340..344, VC-376). They take a
 * `PropertyInput` (a definition, the states a session went through and the transactions
 * between them) and throw an `Error` naming the first violation. Iteration 12 builds the same
 * input from states folded with `Replayer.advance` (VC-379), so the edge path runs exactly
 * these checks.
 */

type State = Snapshot<SessionState>;

export interface PropertyInput {
  readonly def: CompiledGameDefinition;
  /** `states[0]` is the initial state, `states[i + 1] = steps[i].post`. */
  readonly states: readonly State[];
  readonly steps: readonly CaseStep[];
  /** True when the session may contain grants (consistency is relaxed, see `checkConsistency`). */
  readonly grants: boolean;
}

/** Counters a check reports so the runner can assert the properties are not vacuous. */
export interface CheckStats {
  views: number;
  deltas: number;
  /** Canary tokens present in the data but withheld from the output (they must be > 0 overall). */
  withheldTokens: number;
  /** Perturbations applied by VC-343. */
  perturbations: number;
  /** Visible facts the oracle predicted, by kind (zone, counter, meta, gate, grant). */
  facts: Record<string, number>;
  /** Facts visible only because of a grant (not in the static set). */
  grantFacts: number;
}

export const emptyStats = (): CheckStats => ({
  views: 0,
  deltas: 0,
  withheldTokens: 0,
  perturbations: 0,
  facts: {},
  grantFacts: 0,
});

const label = (v: ViewerIdentity): string =>
  `${v.role}${v.subject === undefined ? "" : `@${v.subject}`}`;

function must<T>(
  result: { ok: true; value: T } | { ok: false; error: { detail: string } },
  what: string,
): T {
  if (!result.ok) throw new Error(`${what}: ${result.error.detail}`);
  return result.value;
}

const json = (value: unknown): string =>
  JSON.stringify(value, (_k, v: unknown) =>
    typeof v === "bigint" ? v.toString() : v,
  );

const union = (pre: State, post: State) => ({
  ...(pre.grants as Record<string, unknown>),
  ...(post.grants as Record<string, unknown>),
});

const chains = new WeakMap<CaseStep, State[]>();

/**
 * The states a batch passes through: `pre`, the state after each committed action (with the
 * seq of `pre`, so scopes do not shift mid-batch), then `post`. A `move` entry is a public event
 * for whoever is entitled to either zone at that moment, so what a delta may name is judged
 * over all of them, not just over the two ends.
 */
export function chainOf(def: CompiledGameDefinition, step: CaseStep): State[] {
  const hit = chains.get(step);
  if (hit !== undefined) return hit;
  const out: State[] = [step.pre];
  // Prefixes of the batch from `pre` (single actions would break grant ids, which embed the
  // action index), re-sequenced so `until_seq` scopes read as in `pre`.
  for (let k = 1; k < step.tx.actions.length; k++) {
    const r = apply(def, step.pre, step.tx.actions.slice(0, k));
    if (!r.ok) throw new Error(`chain prefix ${String(k)}: ${r.error.detail}`);
    out.push(
      variant(r.value.state, (d) => {
        d.seq = step.pre.seq;
      }),
    );
  }
  out.push(step.post);
  chains.set(step, out);
  return out;
}

function tokensOfFacts(facts: Facts): Set<string> {
  const out = new Set<string>();
  for (const [key, value] of facts) {
    for (const t of tokensOf(`${key} ${value}`)) out.add(t);
  }
  return out;
}

function viewOf(
  def: CompiledGameDefinition,
  state: State,
  viewer: ViewerIdentity,
) {
  return must(projectView(def, state, viewer), `projectView ${label(viewer)}`);
}

function deltaOf(
  def: CompiledGameDefinition,
  step: CaseStep,
  viewer: ViewerIdentity,
) {
  return must(
    projectDelta(def, step.pre, step.post, step.batch, viewer),
    `projectDelta ${label(viewer)}`,
  );
}

/** VC-340: no canary outside the oracle's entitlement in any View, Delta or log entry. */
export function checkNoLeak(
  input: PropertyInput,
  cls: RoleClass,
  stats: CheckStats,
): void {
  const { def, states, steps } = input;
  const leak = (what: string, text: string, allowed: Set<string>): void => {
    const bad = [...tokensOf(text)].filter((t) => !allowed.has(t));
    if (bad.length > 0) {
      throw new Error(`leak in ${what}: ${bad.slice(0, 5).join(", ")}`);
    }
  };
  const withheld = (data: unknown, allowed: Set<string>): number =>
    [...tokensOf(json(data))].filter((t) => !allowed.has(t)).length;
  states.forEach((state, index) => {
    for (const viewer of viewersOf(cls, state)) {
      const view = viewOf(def, state, viewer);
      const allowed = tokensOfFacts(oracleFacts(def, state, viewer));
      leak(`View ${label(viewer)} state ${String(index)}`, json(view), allowed);
      stats.views += 1;
      stats.withheldTokens += withheld(state, allowed);
    }
  });
  steps.forEach((step, index) => {
    for (const viewer of viewersOf(cls, step.post)) {
      const grants = union(step.pre, step.post);
      const allowed = new Set([
        ...chainOf(def, step).flatMap((state) => [
          ...tokensOfFacts(oracleFacts(def, state, viewer, { grants })),
        ]),
        // A move entry may carry the face of a card the viewer is card_face-entitled to.
        ...tokensOfFacts(oracleCardFaces(def, step.post, viewer, { grants })),
      ]);
      const delta = deltaOf(def, step, viewer);
      const log = must(
        projectLogEntry(def, step.pre, step.post, step.batch, viewer),
        "projectLogEntry",
      );
      const where = `${label(viewer)} step ${String(index)}`;
      leak(`Delta ${where}`, json(delta), allowed);
      leak(`log entry ${where}`, json(log), allowed);
      if (json(log) !== json(delta)) {
        throw new Error(`log entry differs from delta (${where})`);
      }
      stats.deltas += 1;
      stats.withheldTokens += withheld(
        { actions: step.tx.actions, post: step.post },
        allowed,
      );
    }
  });
}

/** VC-341: `projectView` exposes exactly the oracle's facts (and a superset of the static ones). */
export function checkCompleteness(
  input: PropertyInput,
  cls: RoleClass,
  stats: CheckStats,
): void {
  const { def, states } = input;
  states.forEach((state, index) => {
    for (const viewer of viewersOf(cls, state)) {
      const view = viewOf(def, state, viewer);
      const actual = viewFacts(view);
      const diff = diffFacts(oracleFacts(def, state, viewer), actual);
      if (diff.length > 0) {
        throw new Error(
          `view != oracle for ${label(viewer)} at state ${String(index)}:\n  ${diff.join("\n  ")}`,
        );
      }
      const statics = oracleFacts(def, state, viewer, { ignoreGrants: true });
      for (const key of actual.keys()) {
        const kind = key.split("/")[0]!;
        stats.facts[kind] = (stats.facts[kind] ?? 0) + 1;
        if (kind !== "grant" && !statics.has(key)) stats.grantFacts += 1;
      }
      // PBR-002: grants only add.
      for (const [key, value] of statics) {
        if (actual.get(key) !== value) {
          throw new Error(
            `grants removed static fact ${key} (${label(viewer)})`,
          );
        }
      }
      // PFR-021/022: plain JSON, deterministic, `viewer` echoed.
      const again = viewOf(def, state, viewer);
      if (json(again) !== json(view))
        throw new Error("view is not deterministic");
      if (JSON.stringify(view) !== JSON.stringify(JSON.parse(json(view)))) {
        throw new Error("view is not plain JSON");
      }
      if (view.viewer.role !== viewer.role)
        throw new Error("viewer not echoed");
      stats.views += 1;
    }
  });
}

const WILDCARD = JSON.stringify("?");

/** The keys whose value the fold cannot know (orientation of newly visible cards). */
function unknownKeys(facts: Facts): Set<string> {
  const out = new Set<string>();
  for (const [key, value] of facts) {
    if (key.includes("/member/") && value === WILDCARD) out.add(key);
  }
  return out;
}

function without(facts: Facts, keys: ReadonlySet<string>): Facts {
  return new Map([...facts].filter(([key]) => !keys.has(key)));
}

/**
 * VC-342 / PBR-010: folding the deltas onto `projectView(pre)` reproduces `projectView(post)`.
 *
 * Sessions without grants fold the whole stream and compare every fact. With grants, the delta
 * cannot carry content that exists only because a grant was added, re-resolved or has ended
 * (D-019), so each step starts from `projectView(pre)` and the comparison is limited to the
 * facts entitled without any grant (the static facts of the oracle). What the fold holds beyond
 * them (content a consumed `once` grant revealed in this transaction, stale facts of ended
 * grants, zone shells created by move events) is bounded by VC-340 instead. Orientation of a card that newly enters the view is unknown to the fold (D-023).
 */
export function checkConsistency(
  input: PropertyInput,
  cls: RoleClass,
  stats: CheckStats,
): void {
  const { def, states, steps } = input;
  for (const viewer of viewersOf(cls, states[0]!)) {
    let folded: FoldedView | ViewLike = viewOf(def, states[0]!, viewer);
    steps.forEach((step, index) => {
      const where = `${label(viewer)} step ${String(index)}`;
      const delta = deltaOf(def, step, viewer);
      stats.deltas += 1;
      const base: FoldedView | ViewLike = input.grants
        ? viewOf(def, step.pre, viewer)
        : folded;
      const result = foldDelta(def, base, delta);
      // With grants a fold block may be stale (an ended grant's order or listing), so the
      // internal-consistency problems are only asserted for grant-free sessions.
      if (!input.grants && result.problems.length > 0) {
        throw new Error(
          `delta inconsistent (${where}): ${result.problems.join("; ")}`,
        );
      }
      const gotAll = viewFacts(result.view);
      const unknown = unknownKeys(gotAll);
      const got = without(gotAll, unknown);
      const post = viewOf(def, step.post, viewer);
      const want = without(viewFacts(post), unknown);
      if (!input.grants) {
        const diff = diffFacts(want, got);
        if (diff.length > 0) {
          throw new Error(
            `fold != view(post) (${where}):\n  ${diff.join("\n  ")}`,
          );
        }
      } else {
        const stat = without(
          oracleFacts(def, step.post, viewer, { ignoreGrants: true }),
          unknown,
        );
        for (const [key, value] of stat) {
          if (key.startsWith("grant/")) continue;
          if (got.get(key) !== value) {
            throw new Error(
              `fold lacks static fact ${key} (${where}): want ${value}, got ${String(got.get(key))}`,
            );
          }
        }
      }
      folded = result.view;
    });
  }
}

// ---------------------------------------------------------------------------
// VC-343 indistinguishability

interface Perturbed {
  readonly def: CompiledGameDefinition;
  readonly states: State[];
  readonly count: number;
}

function cardsIn(facts: Facts, marker: string): Set<string> {
  const out = new Set<string>();
  for (const key of facts.keys()) {
    const at = key.lastIndexOf(marker);
    if (key.startsWith("zone/") && at >= 0) {
      out.add(key.slice(at + marker.length));
    }
  }
  return out;
}

/**
 * Perturbs, identically in every state of `group`, only data the viewer is not entitled to
 * (judged by the oracle over the whole group): non-visible metadata and card types, hidden
 * counters, secret/other-seat meta, other seats' sealed submissions, delegations, the
 * orientation of unlisted cards, and the identity of unlisted cards (two cards swap places).
 */
function perturb(
  def: CompiledGameDefinition,
  group: readonly State[],
  viewer: ViewerIdentity,
  grants: Record<string, unknown> | undefined,
  judged: readonly State[] = group,
): Perturbed {
  const opts = grants === undefined ? {} : { grants };
  const facts = judged.map(
    (s) =>
      new Map([
        ...oracleFacts(def, s, viewer, opts),
        ...oracleCardFaces(def, s, viewer, opts),
      ]),
  );
  const listed = new Set<string>();
  const faced = new Set<string>();
  const counters = new Set<string>();
  for (const f of facts) {
    for (const c of cardsIn(f, "/member/")) listed.add(c);
    for (const c of cardsIn(f, "/face/")) faced.add(c);
    for (const key of f.keys()) {
      if (key.startsWith("card/")) faced.add(key.split("/")[1]!);
    }
    for (const key of f.keys()) {
      if (key.startsWith("counter/"))
        counters.add(key.slice("counter/".length));
    }
  }
  const privileged = viewer.role === "dealer" || viewer.role === "auditor";
  const hidden = Object.keys(group[0]!.cards)
    .filter((c) => !listed.has(c))
    .sort();
  let count = 0;
  const pairs: [string, string][] = [];
  for (let i = 0; i + 1 < hidden.length; i += 2) {
    pairs.push([hidden[i]!, hidden[i + 1]!]);
  }
  const states = group.map((state) => {
    const d = cloneData(state) as Mutable<SessionState>;
    for (const [card, data] of Object.entries(d.cards)) {
      const decl = def.cards.find((c) => c.id === card);
      for (const [field, value] of Object.entries(data.metadata)) {
        const vis = decl?.metadataVisibility[field];
        const blind =
          vis === undefined ||
          (vis === "secret" && !privileged) ||
          (vis === "subject" && viewer.subject === undefined);
        if (!faced.has(card) || blind) {
          data.metadata[field] =
            typeof value === "string"
              ? `${value}zqpert1x`
              : typeof value === "number"
                ? value + 17
                : value;
          count += 1;
        }
      }
      if (!listed.has(card)) {
        data.orientation =
          data.orientation === "face_up" ? "face_down" : "face_up";
        count += 1;
      }
    }
    for (const id of Object.keys(d.counters)) {
      if (!counters.has(id)) {
        (d.counters as Record<string, bigint>)[id] =
          (d.counters as Record<string, bigint>)[id]! + 5_000_000n;
        count += 1;
      }
    }
    for (const schema of def.metaSchemas) {
      const partition = (d.meta as Record<string, unknown>)[schema.id];
      if (
        typeof partition !== "object" ||
        partition === null ||
        Array.isArray(partition)
      ) {
        continue;
      }
      const fields = partition as Record<string, unknown>;
      for (const [field, value] of Object.entries(fields)) {
        const vis = schema.fieldVisibility[field];
        if (vis === undefined || (vis === "secret" && !privileged)) {
          fields[field] = 424242;
          count += 1;
        } else if (
          vis === "subject" &&
          viewer.role !== "auditor" &&
          typeof value === "object" &&
          value !== null &&
          !Array.isArray(value)
        ) {
          const entries = value as Record<string, unknown>;
          for (const seat of Object.keys(entries)) {
            if (seat !== viewer.subject) {
              entries[seat] = "zqpertx";
              count += 1;
            }
          }
        }
      }
    }
    for (const gate of [
      ...Object.values(d.gates.open),
      ...Object.values(d.gates.resolved),
    ]) {
      const submissions = gate.submissions as Record<string, unknown>;
      for (const seat of Object.keys(submissions)) {
        if (seat !== viewer.subject && viewer.role !== "auditor") {
          submissions[seat] = { bid: "zqpertx" };
          count += 1;
        }
      }
    }
    d.delegations = d.delegations.map((x) => ({ ...x, principal: "zqpertx" }));
    for (const [x, y] of pairs) {
      const cx = d.cards[x as never];
      const cy = d.cards[y as never];
      if (cx === undefined || cy === undefined) continue;
      (d.cards as Record<string, unknown>)[x] = cy;
      (d.cards as Record<string, unknown>)[y] = cx;
      for (const zone of Object.values(d.zones)) {
        zone.members = zone.members.map((c) =>
          c === x ? (y as never) : c === y ? (x as never) : c,
        );
      }
      count += 1;
    }
    return d;
  });
  const unlistedFaceless = new Set(
    Object.keys(group[0]!.cards).filter((c) => !faced.has(c)),
  );
  const retyped: CompiledGameDefinition = {
    ...def,
    cards: def.cards.map((card) =>
      unlistedFaceless.has(card.id) && card.type !== undefined
        ? { ...card, type: `${card.type}zqpert2x` }
        : card,
    ),
  };
  count += def.cards.filter(
    (c) => unlistedFaceless.has(c.id) && c.type !== undefined,
  ).length;
  return { def: retyped, states, count };
}

/** VC-343: perturbing non-entitled data leaves every View and Delta unchanged. */
export function checkIndistinguishable(
  input: PropertyInput,
  cls: RoleClass,
  stats: CheckStats,
): void {
  const { def, states, steps } = input;
  states.forEach((state, index) => {
    for (const viewer of viewersOf(cls, state)) {
      const p = perturb(def, [state], viewer, undefined);
      stats.perturbations += p.count;
      const a = json(viewOf(def, state, viewer));
      const b = json(viewOf(p.def, p.states[0]!, viewer));
      if (a !== b) {
        throw new Error(
          `view of ${label(viewer)} at state ${String(index)} changed under perturbation`,
        );
      }
    }
  });
  steps.forEach((step, index) => {
    for (const viewer of viewersOf(cls, step.post)) {
      const p = perturb(
        def,
        [step.pre, step.post],
        viewer,
        union(step.pre, step.post),
        chainOf(def, step),
      );
      stats.perturbations += p.count;
      const a = json(deltaOf(def, step, viewer));
      const b = json(
        must(
          projectDelta(p.def, p.states[0]!, p.states[1]!, step.batch, viewer),
          "projectDelta (perturbed)",
        ),
      );
      if (a !== b) {
        throw new Error(
          `delta of ${label(viewer)} at step ${String(index)} changed under perturbation`,
        );
      }
    }
  });
}

// ---------------------------------------------------------------------------
// VC-344 mutation guard

/** A hostile caller: casts away readonly and edits a value in place, deeply. */
export function hostileMutate(value: unknown): void {
  if (typeof value !== "object" || value === null) return;
  try {
    if (Array.isArray(value)) {
      for (const item of value) hostileMutate(item);
      value.reverse();
      value.push("zqhostilex");
      return;
    }
    const record = value as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      hostileMutate(record[key]);
      if (typeof record[key] === "string") record[key] = "zqhostilex";
      if (typeof record[key] === "number") record[key] = -1;
    }
    delete record[Object.keys(record)[0] ?? ""];
    record.zqhostile = { deep: ["zqhostilex"] };
  } catch {
    // A frozen output is also fine: the mutation did not happen.
  }
}

/** VC-344: mutating a returned View/Delta changes neither the state nor later projections. */
export function checkMutationGuard(
  input: PropertyInput,
  cls: RoleClass,
  stats: CheckStats,
): void {
  const { def, states, steps } = input;
  const guard = (
    what: string,
    touched: readonly State[],
    project: () => unknown,
  ): void => {
    const digests = touched.map((s) => stateDigest(def, s));
    const copies = touched.map((s) => json(s));
    const first = project();
    const before = json(first);
    hostileMutate(first);
    if (json(project()) !== before) {
      throw new Error(`${what}: output changed after a hostile mutation`);
    }
    touched.forEach((s, i) => {
      if (stateDigest(def, s) !== digests[i] || json(s) !== copies[i]) {
        throw new Error(`${what}: state changed after a hostile mutation`);
      }
      if (!isDeepFrozen(s)) throw new Error(`${what}: state lost its freeze`);
    });
  };
  const last = states[states.length - 1]!;
  for (const viewer of viewersOf(cls, last)) {
    guard(`View ${label(viewer)}`, [last], () => viewOf(def, last, viewer));
    stats.views += 1;
  }
  const step = steps[steps.length - 1];
  if (step !== undefined) {
    for (const viewer of viewersOf(cls, step.post)) {
      guard(`Delta ${label(viewer)}`, [step.pre, step.post], () =>
        deltaOf(def, step, viewer),
      );
      stats.deltas += 1;
    }
  }
}

// ---------------------------------------------------------------------------
// VC-376 error details

const PROBE_ROLES = [
  "",
  "nobody",
  "Player",
  "zqrole9x",
  "__proto__",
  "constructor",
  "player ",
];

function wordIn(text: string, word: string): boolean {
  const esc = word.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  return new RegExp(`(^|[^A-Za-z0-9_.:/-])${esc}([^A-Za-z0-9_.:/-]|$)`).test(
    text,
  );
}

/**
 * VC-376 / PBR-008: every error of PFR-002..005 (and the batch-mismatch error) carries the
 * code the oracle predicts and a detail with no canary, no card, zone, counter, team, player or
 * unsupplied seat id, only the role and subject the caller supplied.
 */
export function checkErrorDetails(
  input: PropertyInput,
  _cls: RoleClass,
  stats: CheckStats,
): void {
  const { def, states, steps } = input;
  const state = states[states.length - 1]!;
  const seats = Object.keys(state.roster.seats);
  const probes: ViewerIdentity[] = [];
  const subject = (s: string) => must(seatId(s), "seat");
  for (const role of PROBE_ROLES) probes.push({ role });
  probes.push(
    { role: "nobody", subject: subject(seats[0]!) },
    { role: "spectator", subject: subject(seats[0]!) },
    { role: "dealer", subject: subject(seats[0]!) },
    { role: "auditor", subject: subject(seats[1]!) },
    { role: "player" },
    { role: "captain" },
    { role: "player", subject: "ghost-seat" as SeatId },
    { role: "coach", subject: "zqseat9x" as SeatId },
    { role: "dealer" },
    { role: "auditor" },
  );
  const ids = [
    ...Object.keys(state.cards),
    ...Object.keys(state.zones),
    ...Object.keys(state.counters),
    ...def.counters.map((c) => c.id as string),
    ...def.teams,
    ...Object.values(state.roster.seats).flatMap((s) =>
      s.player === undefined ? [] : [s.player as string],
    ),
  ];
  const secrets = tokensOf(json(state));
  for (const viewer of probes) {
    const expected = expectedViewerError(def, state, viewer);
    const supplied = [viewer.role, viewer.subject].filter(
      (x): x is string => x !== undefined && x !== "",
    );
    const results: {
      name: string;
      result: { ok: boolean; error?: { code: string; detail: string } };
    }[] = [{ name: "projectView", result: projectView(def, state, viewer) }];
    const step = steps[steps.length - 1];
    if (step !== undefined) {
      results.push(
        {
          name: "projectDelta",
          result: projectDelta(def, step.pre, step.post, step.batch, viewer),
        },
        {
          name: "projectLogEntry",
          result: projectLogEntry(def, step.pre, step.post, step.batch, viewer),
        },
      );
    }
    for (const { name, result } of results) {
      const code = result.ok ? null : (result.error?.code ?? "?");
      if (code !== expected) {
        throw new Error(
          `${name} ${label(viewer)}: expected ${String(expected)}, got ${String(code)}`,
        );
      }
      if (result.ok || result.error === undefined) continue;
      let detail = result.error.detail;
      for (const s of supplied) detail = detail.split(s).join("");
      for (const token of secrets) {
        if (detail.includes(token))
          throw new Error(`${name}: detail leaks ${token}`);
      }
      for (const id of ids) {
        if (wordIn(detail, id)) throw new Error(`${name}: detail names ${id}`);
      }
      for (const seat of seats) {
        if (wordIn(detail, seat)) {
          throw new Error(`${name}: detail names unsupplied seat ${seat}`);
        }
      }
      stats.views += 1;
    }
  }
  // A batch that is not the transaction between pre and post: REPLAY_INVALID, no content.
  const step = steps[0];
  if (step !== undefined) {
    const viewer = viewersOf("player", step.post)[0]!;
    const wrong = projectDelta(def, step.post, step.pre, step.batch, viewer);
    const other = projectDelta(
      def,
      step.pre,
      step.post,
      sealBatch({ ...step.tx, seq: null }),
      viewer,
    );
    for (const result of [wrong, other]) {
      if (result.ok || result.error.code !== "REPLAY_INVALID") {
        throw new Error("mismatched batch did not give REPLAY_INVALID");
      }
      if (tokensOf(result.error.detail).size > 0) {
        throw new Error(`REPLAY_INVALID leaks: ${result.error.detail}`);
      }
      stats.deltas += 1;
    }
  }
}
