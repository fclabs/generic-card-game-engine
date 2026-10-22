import fc from "fast-check";
import type { CompiledGameDefinition } from "../definition/types.js";
import type { Result } from "../errors/result.js";
import { A } from "./actions.testing.js";
import type { Action, Macro } from "./actions.js";
import { apply } from "./apply/index.js";
import type { ApplyOptions, ApplySuccess } from "./apply/types.js";
import {
  buildReducerDefinition,
  engine,
  meta,
  rosterOp,
} from "./apply/reducers.testing.js";
import { startState } from "./apply/apply.testing.js";
import { cardId, counterId, playerId, seatId, teamId, zoneId } from "./ids.js";
import type { Snapshot } from "./snapshot.js";
import type { JsonValue, RosterEntry, SessionState } from "./state.js";

/**
 * fast-check support for the Phase 1 property tests (VC-022, VC-090, VC-091, VC-092).
 *
 * Generation is *tape driven*: fast-check produces an array of small integers (the tape)
 * and the builders below consume it deterministically to pick kinds, ids and numbers.
 * That keeps shrinking simple (a shorter or smaller tape is a simpler stream) and keeps
 * this module free of any randomness of its own. Actions are generated against the state
 * the batch would see (each generated action is applied to a preview of the state, so
 * most actions are legal there), and an `illegalPercent` share is deliberately corrupted:
 * unknown ids, out-of-range positions, bad permutations, derived or unbounded counters,
 * reserved grantees, unknown schemas, and so on.
 */

/** Deterministic integer source over a fixed tape (wraps around; an empty tape gives 0). */
export class Tape {
  private index = 0;
  constructor(private readonly values: readonly number[]) {}

  /** An integer in `[0, n)`; `n <= 0` gives 0. */
  int(n: number): number {
    if (n <= 0 || this.values.length === 0) return 0;
    const value = this.values[this.index % this.values.length] ?? 0;
    this.index += 1;
    return value % n;
  }

  /** True with probability `percent / 100`. */
  chance(percent: number): boolean {
    return this.int(100) < percent;
  }

  /** One element of a non-empty list. */
  pick<T>(items: readonly T[]): T {
    const item = items[this.int(items.length)];
    if (item === undefined) throw new Error("pick from an empty list");
    return item;
  }

  /** A fresh uniformly shuffled copy (Fisher-Yates over the tape). */
  shuffled<T>(items: readonly T[]): T[] {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      const a = out[i];
      const b = out[j];
      if (a === undefined || b === undefined) continue;
      out[i] = b;
      out[j] = a;
    }
    return out;
  }
}

/** fast-check arbitrary for a tape: 16-400 integers in `[0, 1e6]`. */
export const tapeArbitrary: fc.Arbitrary<number[]> = fc.array(
  fc.nat({ max: 1_000_000 }),
  { minLength: 16, maxLength: 400 },
);

const PROPERTY_SEATS = ["s1", "s2", "s3"] as const;
const SEAT_TEAMS: Readonly<Record<string, string>> = {
  s1: "t1",
  s2: "t2",
  s3: "t1",
};
const PLAYERS = ["p1", "p2", "p3", "p4"] as const;
const PRINCIPALS = ["alice", "bob", "carol"] as const;
const COUNTERS = ["pot", "bank", "reserve", "tally"] as const;
const ROUNDING_COUNTERS = ["bank", "reserve", "tally"] as const;
const GATES = ["g1", "g2", "g3"] as const;

/**
 * The definition the generators target: 3 seats on 2 teams, 4 zones (2 ordered), 8 cards,
 * templates `hand` (seat, unordered, max 2), `pile` (none, ordered, max 3) and `stack`
 * (team, ordered, max 2), counters `pot`, `bank` (mint), `reserve` (floor), `tally`
 * (half_up, outside the group) and a derived `total` (cards in `deck`), conservation group
 * `chips = [pot, bank, reserve]`, meta schemas `notes`, `score`, `blob` and a roster reducer.
 */
export function buildPropertyDefinition(): CompiledGameDefinition {
  const seats = PROPERTY_SEATS.map((id) => ({
    id: mustId(seatId(id)),
    team: mustId(teamId(SEAT_TEAMS[id] ?? "t1")),
  }));
  const counter = (
    id: string,
    over: Partial<CompiledGameDefinition["counters"][number]>,
  ): CompiledGameDefinition["counters"][number] => ({
    id: mustId(counterId(id)),
    owner: "table",
    visibility: {},
    min: 0n,
    initial: 0n,
    ...over,
  });
  const zone = (id: string, ordered: boolean) => ({
    id: mustId(zoneId(id)),
    ordered,
    visibility: {},
  });
  return {
    ...buildReducerDefinition(),
    cards: Array.from({ length: 8 }, (_, i) => ({
      id: mustId(cardId(`c${String(i + 1)}`)),
      type: "playing",
      metadataSchema: { rank: "int" as const, suit: "string" as const },
      startingZone: mustId(zoneId("deck")),
      initialMetadata: {},
      metadataVisibility: {},
    })),
    zones: [
      zone("deck", true),
      zone("discard", true),
      zone("table", false),
      zone("hold", false),
    ],
    zoneTemplates: [
      {
        name: "hand",
        ownerRule: "seat",
        ordered: false,
        maxInstances: 2,
        visibility: {},
      },
      {
        name: "pile",
        ownerRule: "none",
        ordered: true,
        maxInstances: 3,
        visibility: {},
      },
      {
        name: "stack",
        ownerRule: "team",
        ordered: true,
        maxInstances: 2,
        visibility: {},
      },
    ],
    counters: [
      counter("pot", {}),
      counter("bank", {
        max: 1000n,
        initial: 100n,
        scale: 2,
        rounding: "half_even",
        supplyRole: "mint",
      }),
      counter("reserve", {
        max: 500n,
        initial: 50n,
        rounding: "floor",
      }),
      counter("tally", {
        min: -100n,
        max: 100n,
        rounding: "half_up",
      }),
      counter("total", {
        derived: (state) =>
          BigInt(
            Object.entries(state.zones).find(([id]) => id === "deck")?.[1]
              .members.length ?? 0,
          ),
      }),
    ],
    conservationGroups: [
      {
        id: "chips",
        counters: ["pot", "bank", "reserve"].map((id) => mustId(counterId(id))),
      },
    ],
    seats,
    teams: [mustId(teamId("t1")), mustId(teamId("t2"))],
    control: {
      phases: ["setup", "play", "end"],
      initialPhase: "play",
      turnOrder: seats.map((s) => s.id),
      initialActiveSeats: [mustId(seatId("s1"))],
      pointerNames: ["dealer"],
      enforceActiveSeats: true,
      outOfTurnKinds: ["chat"],
    },
  };
}

/** Roster matching `buildPropertyDefinition()`. */
export function propertyRoster(): RosterEntry[] {
  return PROPERTY_SEATS.map((id) => ({
    seat: mustId(seatId(id)),
    team: mustId(teamId(SEAT_TEAMS[id] ?? "t1")),
    ...(id === "s1" ? { player: mustId(playerId("p1")) } : {}),
  }));
}

/** A fresh session over `buildPropertyDefinition()`. */
export function propertyStart(
  def: CompiledGameDefinition = buildPropertyDefinition(),
): Snapshot<SessionState> {
  return startState(def, propertyRoster());
}

/** Kinds `generateAction` can produce (15 primitives incl. every roster/engine variant, 3 macros). */
export const GENERATED_KINDS: readonly string[] = [
  "move",
  "flip",
  "shuffle",
  "set_metadata",
  "lifecycle",
  "counter_adjust",
  "counter_transfer",
  "control_set",
  "control_advance",
  "grant_view",
  "revoke_view",
  "zone_create",
  "zone_destroy",
  "roster",
  "meta",
  "engine",
  "draw",
  "zone_merge",
  "reset_to_zone",
];

// Weighted kind table (index by tape). Lifecycle is rare so streams live long enough.
const KIND_WEIGHTS: readonly (readonly [string, number])[] = [
  ["move", 30],
  ["flip", 6],
  ["shuffle", 5],
  ["set_metadata", 6],
  ["lifecycle", 1],
  ["counter_adjust", 9],
  ["counter_transfer", 9],
  ["control_set", 5],
  ["control_advance", 4],
  ["grant_view", 5],
  ["revoke_view", 3],
  ["zone_create", 5],
  ["zone_destroy", 3],
  ["roster", 5],
  ["meta", 5],
  ["engine", 8],
  ["draw", 8],
  ["zone_merge", 3],
  ["reset_to_zone", 3],
];
const KIND_TOTAL = KIND_WEIGHTS.reduce((n, [, w]) => n + w, 0);

function pickKind(t: Tape): string {
  let roll = t.int(KIND_TOTAL);
  for (const [kind, weight] of KIND_WEIGHTS) {
    if (roll < weight) return kind;
    roll -= weight;
  }
  return "move";
}

function mustId<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error.detail);
  return result.value;
}
type S = Snapshot<SessionState>;

function zoneIdsOf(s: S): string[] {
  return Object.keys(s.zones);
}
function cardIdsOf(s: S): string[] {
  return Object.keys(s.cards);
}
function membersOf(s: S, zone: string): readonly string[] {
  return Object.entries(s.zones).find(([id]) => id === zone)?.[1].members ?? [];
}
function zoneOfCard(s: S, card: string): string | undefined {
  return Object.entries(s.cards).find(([id]) => id === card)?.[1].zone;
}
function isOrderedZone(def: CompiledGameDefinition, s: S, zone: string) {
  const state = Object.entries(s.zones).find(([id]) => id === zone)?.[1];
  if (state?.template !== undefined) {
    return (
      def.zoneTemplates.find((t) => t.name === state.template)?.ordered ?? false
    );
  }
  return def.zones.find((z) => z.id === zone)?.ordered ?? false;
}

function genMove(def: CompiledGameDefinition, s: S, t: Tape, bad: boolean) {
  const card = t.pick(cardIdsOf(s));
  const actual = zoneOfCard(s, card) ?? "deck";
  const zones = zoneIdsOf(s);
  const to = t.pick(zones);
  const from = bad && t.chance(40) ? t.pick(zones) : actual;
  const toCard = bad && t.chance(15) ? "ghost-card" : card;
  const toZone = bad && t.chance(15) ? "ghost-zone" : to;
  let position: number | undefined;
  if (isOrderedZone(def, s, to)) {
    const length = membersOf(s, to).length - (to === actual ? 1 : 0);
    position = t.int(Math.max(length, 0) + 1);
    if (bad && t.chance(40)) position = t.pick([-1, length + 1, length + 7]);
    if (bad && t.chance(15)) position = undefined;
  } else if (bad && t.chance(30)) {
    position = 0;
  }
  return A.move(toCard, from, toZone, position);
}

function genShuffle(def: CompiledGameDefinition, s: S, t: Tape, bad: boolean) {
  const ordered = zoneIdsOf(s).filter((z) => isOrderedZone(def, s, z));
  const zone = bad && t.chance(15) ? t.pick(zoneIdsOf(s)) : t.pick(ordered);
  let permutation = t.shuffled(membersOf(s, zone));
  if (bad && t.chance(60)) {
    const mode = t.int(3);
    if (mode === 0) permutation = permutation.slice(1);
    else if (mode === 1) permutation = [...permutation, "c1"];
    else
      permutation = permutation.map(
        (_, i) => permutation[0] ?? `x${String(i)}`,
      );
  }
  return A.shuffle(zone, permutation);
}

const GROUP_COUNTERS = ["pot", "bank", "reserve"] as const;

function genCounter(t: Tape, bad: boolean, pool: readonly string[]) {
  if (bad && t.chance(20)) return t.pick(["total", "ghost-counter"]);
  return t.pick(pool);
}

function valueOf(s: S, counter: string): bigint {
  return Object.entries(s.counters).find(([id]) => id === counter)?.[1] ?? 0n;
}

function genRatio(t: Tape): [bigint, bigint] | undefined {
  return t.chance(25)
    ? [BigInt(t.int(5) + 1), BigInt(t.int(4) + 1)]
    : undefined;
}

// Legal adjusts touch only the supply member (`bank`) or the counter outside the group
// (`tally`); an adjust of the other group members breaks conservation, so it is a bad variant.
function genAdjust(t: Tape, bad: boolean) {
  const counter = genCounter(t, bad, bad ? COUNTERS : ["bank", "tally"]);
  let delta = BigInt(t.int(61) - 30);
  if (bad && t.chance(20)) delta = t.chance(50) ? 2n ** 70n : -(2n ** 70n);
  const ratio = genRatio(t);
  const withRatio =
    ratio !== undefined &&
    (bad || ROUNDING_COUNTERS.some((c) => c === counter));
  return A.adjust(counter, delta, withRatio ? ratio : undefined);
}

// Legal transfers stay inside the conservation group, from a counter that holds something.
function genTransfer(s: S, t: Tape, bad: boolean) {
  const funded = GROUP_COUNTERS.filter((c) => valueOf(s, c) > 0n);
  const from = bad
    ? genCounter(t, bad, COUNTERS)
    : t.pick(funded.length > 0 ? funded : GROUP_COUNTERS);
  const to = genCounter(t, bad, bad ? COUNTERS : GROUP_COUNTERS);
  const balance = Number(valueOf(s, from) > 60n ? 60n : valueOf(s, from));
  const amount =
    bad && t.chance(15)
      ? -3n
      : BigInt(t.int(bad && t.chance(40) ? 61 : balance + 1));
  const ratio = genRatio(t);
  const remainderTo = t.chance(70)
    ? t.pick(bad ? COUNTERS : GROUP_COUNTERS)
    : undefined;
  return A.transfer(from, to, amount, {
    ...(ratio ? { ratio } : {}),
    ...(remainderTo !== undefined ? { remainderTo } : {}),
  });
}

function seatsOf(s: S): string[] {
  return Object.keys(s.roster.seats);
}

function genControlSet(
  def: CompiledGameDefinition,
  s: S,
  t: Tape,
  bad: boolean,
) {
  const seats = seatsOf(s);
  const opts: Parameters<typeof A.controlSet>[0] = {};
  const phases = def.control.phases;
  if (t.chance(50)) opts.phase = bad && t.chance(30) ? "nope" : t.pick(phases);
  if (t.chance(50)) {
    const count = t.int(3) + 1;
    opts.activeSeats = t
      .shuffled(seats)
      .slice(0, count)
      .map((id) => (bad && t.chance(20) ? "ghost-seat" : id));
  }
  if (t.chance(30)) opts.direction = t.chance(50) ? 1 : -1;
  if (t.chance(30)) {
    opts.pointer = {
      name: t.pick(["dealer", "button"]),
      seat: bad && t.chance(20) ? "ghost-seat" : t.pick(seats),
    };
  }
  return A.controlSet(opts);
}

function genGrant(def: CompiledGameDefinition, s: S, t: Tape, bad: boolean) {
  const zones = zoneIdsOf(s);
  const orderedZones = zones.filter((z) => isOrderedZone(def, s, z));
  const kind = t.int(3);
  const target: JsonValue =
    kind === 0
      ? { kind: "card", card_id: t.pick(cardIdsOf(s)) }
      : kind === 1
        ? { kind: "zone", zone_id: t.pick(zones) }
        : { kind: "top", zone_id: t.pick(bad ? zones : orderedZones) };
  const keys = t.chance(50) ? ["hand"] : ["hand", "public"];
  const grantees = [...seatsOf(s), "all_seated", "team:t1", "team:t2"];
  const grantee =
    bad && t.chance(40) ? t.pick(["dealer", "team:zz"]) : t.pick(grantees);
  const scopeKind = t.int(3);
  const scope: JsonValue =
    scopeKind === 0
      ? { kind: "until_revoked" }
      : scopeKind === 1
        ? {
            kind: "until_seq",
            n: s.seq + 1 + t.int(5) - (bad && t.chance(30) ? 4 : 0),
          }
        : { kind: "once" };
  return A.grant(target, bad && t.chance(15) ? ["zzz"] : keys, grantee, scope);
}

function genZoneCreate(
  def: CompiledGameDefinition,
  s: S,
  t: Tape,
  bad: boolean,
) {
  const template = def.zoneTemplates[t.int(def.zoneTemplates.length)];
  if (template === undefined) return A.zoneCreate("hand", "s1");
  let owner: string | undefined;
  if (template.ownerRule === "seat") owner = t.pick(seatsOf(s));
  else if (template.ownerRule === "team") owner = t.pick(["t1", "t2"]);
  if (bad && t.chance(30)) owner = owner === undefined ? "s1" : undefined;
  return A.zoneCreate(template.name, owner);
}

function templateZones(s: S): string[] {
  return Object.entries(s.zones)
    .filter(([, z]) => z.template !== undefined)
    .map(([id]) => id);
}

function genRoster(s: S, t: Tape, bad: boolean): Action {
  const seats = seatsOf(s);
  const seat = bad && t.chance(15) ? "ghost-seat" : t.pick(seats);
  const mode = t.int(4);
  if (mode === 0) return A.delegate(seat, t.pick(PRINCIPALS));
  if (mode === 1 && (bad || s.delegations.length > 0)) {
    const existing = s.delegations[t.int(Math.max(s.delegations.length, 1))];
    return existing !== undefined && !bad
      ? A.revokeDelegation(existing.seat, existing.principal)
      : A.revokeDelegation(seat, t.pick(PRINCIPALS));
  }
  if (mode === 2) return A.substitute(seat, t.pick(PLAYERS));
  return rosterOp("set_status", {
    seat_id: seat,
    status: t.pick(["seated", "sitting_out", "eliminated"]),
  });
}

function genMeta(t: Tape, bad: boolean): Action {
  const mode = t.int(3);
  if (bad && t.chance(40)) {
    return t.pick<Action>([
      meta("ghost-schema", {}),
      meta("notes", { text: 1.5 }),
      meta("score", { points: "x" }),
      meta("notes", { nope: "x" }),
    ]);
  }
  if (mode === 0) return meta("notes", { text: `n${String(t.int(100))}` });
  if (mode === 1) return meta("score", { points: t.int(1000) });
  return meta("blob", { data: [t.int(10), { k: t.chance(50) }] });
}

function genEngine(s: S, t: Tape, bad: boolean): Action {
  const open = Object.entries(s.gates.open);
  const used = new Set([
    ...open.map(([id]) => id),
    ...Object.keys(s.gates.resolved),
  ]);
  const free = GATES.filter((g) => !used.has(g));
  const seats = seatsOf(s);
  const grants = Object.keys(s.grants);
  // Legal: open an unused gate, or act on an open one; fall back to opening when impossible.
  let mode = t.int(6);
  if (!bad) {
    if (open.length === 0 && mode < 4 && mode > 0) mode = 0;
    if (mode === 0 && free.length === 0) mode = open.length > 0 ? 3 : 4;
    if (mode >= 4 && grants.length === 0) mode = free.length > 0 ? 0 : 3;
    if (mode === 3 && open.length === 0) mode = free.length > 0 ? 0 : 4;
  }
  const anyGate = t.pick([...GATES]);
  if (mode === 0) {
    const expected = t.shuffled(seats).slice(0, t.int(seats.length) + 1);
    return engine("gate_open", {
      gate_id: bad && t.chance(40) ? anyGate : (free[0] ?? anyGate),
      schema_id: "bid",
      expected_seats: bad && t.chance(20) ? [] : expected,
    });
  }
  const chosen = open.length > 0 ? open[t.int(open.length)] : undefined;
  const resolvedIds = Object.keys(s.gates.resolved);
  const target =
    bad && resolvedIds.length > 0 && t.chance(40)
      ? t.pick(resolvedIds)
      : chosen !== undefined && !(bad && t.chance(20))
        ? chosen[0]
        : anyGate;
  const expectedSeats = chosen?.[1].expectedSeats ?? seats;
  if (mode === 1) {
    return engine("gate_submit", {
      gate_id: target,
      seat: bad && t.chance(30) ? "s3" : t.pick(expectedSeats),
      payload: { bid: t.int(50) },
    });
  }
  if (mode === 2) {
    const submitted =
      chosen === undefined ? [] : Object.keys(chosen[1].submissions);
    return engine("gate_retract", {
      gate_id: target,
      seat:
        !bad && submitted.length > 0
          ? t.pick(submitted)
          : t.pick(expectedSeats),
    });
  }
  if (mode === 3) return engine("gate_resolve", { gate_id: target });
  const grant =
    grants.length > 0 && !(bad && t.chance(20))
      ? (grants[t.int(grants.length)] ?? "grant/0/0")
      : "grant/0/0";
  return engine(mode === 4 ? "grant_expire" : "grant_consume", {
    grant_id: grant,
  });
}

function genDraw(
  def: CompiledGameDefinition,
  s: S,
  t: Tape,
  bad: boolean,
): Macro {
  const zones = zoneIdsOf(s);
  const ordered = zones.filter((z) => isOrderedZone(def, s, z));
  const from = bad && t.chance(15) ? t.pick(zones) : t.pick(ordered);
  const others = zones.filter((z) => z !== from);
  const to = bad && t.chance(10) ? from : t.pick(others);
  const length = membersOf(s, from).length;
  const count =
    bad && t.chance(30) ? length + 2 : t.int(Math.min(length, 4) + 1);
  const position =
    t.chance(30) && isOrderedZone(def, s, to)
      ? t.int(membersOf(s, to).length + 1)
      : undefined;
  return A.draw(from, count, to, position);
}

/** One random action or macro against `s`; `bad` makes it a deliberately corrupted variant. */
export function generateAction(
  def: CompiledGameDefinition,
  s: S,
  t: Tape,
  bad: boolean,
): Action | Macro {
  const kind = pickKind(t);
  switch (kind) {
    case "move":
      return genMove(def, s, t, bad);
    case "flip":
      return A.flip(
        bad && t.chance(30) ? "ghost-card" : t.pick(cardIdsOf(s)),
        t.chance(50) ? "face_up" : "face_down",
      );
    case "shuffle":
      return genShuffle(def, s, t, bad);
    case "set_metadata": {
      const fields =
        bad && t.chance(50)
          ? t.pick<{ [k: string]: JsonValue }>([
              { bogus: 1 },
              { rank: "ten" },
              { suit: 5 },
            ])
          : {
              rank: t.int(13),
              ...(t.chance(50) ? { suit: t.pick(["h", "s"]) } : {}),
            };
      return A.setMetadata(t.pick(cardIdsOf(s)), fields);
    }
    case "lifecycle":
      return A.lifecycle(
        bad && t.chance(40)
          ? "active"
          : t.chance(60)
            ? "completed"
            : "terminated",
        t.chance(50) ? { winner: t.pick(seatsOf(s)) } : undefined,
      );
    case "counter_adjust":
      return genAdjust(t, bad);
    case "counter_transfer":
      return genTransfer(s, t, bad);
    case "control_set":
      return genControlSet(def, s, t, bad);
    case "control_advance": {
      const pointers = Object.keys(s.control.pointers);
      const pointer =
        t.chance(25) && (bad || pointers.length > 0)
          ? t.pick(bad ? ["dealer", "button"] : pointers)
          : undefined;
      return A.advance(bad && t.chance(20) ? 0 : t.int(5) + 1, pointer);
    }
    case "grant_view":
      return genGrant(def, s, t, bad);
    case "revoke_view": {
      const grants = Object.keys(s.grants);
      if (grants.length === 0 && !bad) return genGrant(def, s, t, false);
      return A.revoke(
        grants.length > 0 && !(bad && t.chance(30))
          ? (grants[t.int(grants.length)] ?? "grant/0/0")
          : "grant/0/0",
      );
    }
    case "zone_create":
      return genZoneCreate(def, s, t, bad);
    case "zone_destroy": {
      const pool = templateZones(s).filter(
        (z) => membersOf(s, z).length === 0 || bad,
      );
      if (pool.length === 0 && !bad) return genZoneCreate(def, s, t, false);
      const zone =
        pool.length > 0 && !(bad && t.chance(30))
          ? t.pick(pool)
          : t.pick(zoneIdsOf(s));
      return A.zoneDestroy(zone);
    }
    case "roster":
      return genRoster(s, t, bad);
    case "meta":
      return genMeta(t, bad);
    case "engine":
      return genEngine(s, t, bad);
    case "draw":
      return genDraw(def, s, t, bad);
    case "zone_merge": {
      const pool = templateZones(s);
      if (pool.length >= 2 && !(bad && t.chance(30))) {
        const [a, b] = t.shuffled(pool);
        if (a !== undefined && b !== undefined) return A.zoneMerge(a, b);
      }
      if (!bad) return genZoneCreate(def, s, t, false);
      return A.zoneMerge(t.pick(zoneIdsOf(s)), t.pick(zoneIdsOf(s)));
    }
    default: {
      const zones = zoneIdsOf(s);
      const to = t.pick(zones);
      const sources = t
        .shuffled(zones.filter((z) => z !== to))
        .slice(0, t.int(3) + 1);
      return A.reset(bad && t.chance(20) ? [...sources, to] : sources, to);
    }
  }
}

export interface GenerateOptions {
  /** Percent of actions that are deliberately corrupted (default 12). */
  readonly illegalPercent?: number;
  /** Maximum actions per batch (default 5). */
  readonly maxLength?: number;
  /**
   * Post-processes each generated action before it is previewed and kept (Phase 3 uses it to
   * inject canary payloads and to retarget grant keys). It must not consume more tape than a
   * constant amount per call so streams stay reproducible per tape.
   */
  readonly rewrite?: (
    action: Action | Macro,
    t: Tape,
    bad: boolean,
  ) => Action | Macro;
}

export interface GeneratedBatch {
  readonly batch: readonly (Action | Macro)[];
  readonly opts: ApplyOptions;
}

/**
 * A random batch for `state`. Each action is generated against a preview of the state (the
 * result of the earlier actions that applied on their own), so most batches are valid and
 * the corrupted share makes the rest fail at a random index. A legal `lifecycle` ends the
 * batch (it must be last). About 10 % of batches carry a `player` proposal descriptor.
 */
export function generateBatch(
  def: CompiledGameDefinition,
  state: S,
  t: Tape,
  options: GenerateOptions = {},
): GeneratedBatch {
  const illegal = options.illegalPercent ?? 12;
  const length = t.int(options.maxLength ?? 5) + 1;
  const batch: (Action | Macro)[] = [];
  let preview = state;
  for (let i = 0; i < length; i++) {
    const bad = t.chance(illegal);
    const generated = generateAction(def, preview, t, bad);
    const action =
      options.rewrite === undefined
        ? generated
        : options.rewrite(generated, t, bad);
    batch.push(action);
    if (action.kind === "lifecycle") break;
    const r = apply(def, preview, [action]);
    if (r.ok) preview = r.value.state;
  }
  const opts: ApplyOptions = t.chance(10)
    ? {
        proposal: {
          origin: "player",
          kind: t.pick(["chat", "play"]),
          actingSeat: mustId(seatId(t.pick(seatsOf(state)))),
        },
      }
    : {};
  return { batch, opts };
}

export interface GeneratedStep extends GeneratedBatch {
  readonly before: S;
  readonly result: Result<ApplySuccess>;
}

/**
 * `batches` consecutive random batches applied from `start`. A failed batch leaves the
 * state where it was (the next batch is generated against the same state); a successful
 * one advances it. Every step records its input state, batch, options and result.
 */
export function generateStream(
  def: CompiledGameDefinition,
  start: S,
  t: Tape,
  batches: number,
  options: GenerateOptions = {},
): GeneratedStep[] {
  const steps: GeneratedStep[] = [];
  let state = start;
  for (let i = 0; i < batches; i++) {
    const generated = generateBatch(def, state, t, options);
    const result = apply(def, state, generated.batch, generated.opts);
    steps.push({ ...generated, before: state, result });
    if (result.ok) state = result.value.state;
  }
  return steps;
}
