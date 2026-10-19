import type { Result } from "../errors/result.js";
import { cardId, counterId, seatId, teamId, zoneId } from "../session/ids.js";
import type { CompiledGameDefinition } from "./types.js";

function must<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error.detail);
  return result.value;
}

const cid = (v: string) => must(cardId(v));
const zid = (v: string) => must(zoneId(v));
const kid = (v: string) => must(counterId(v));
const sid = (v: string) => must(seatId(v));
const tid = (v: string) => must(teamId(v));

const identity = (partition: unknown): unknown => partition;

/**
 * A small valid definition touching every KFR-100 component: 2 seats on 2
 * teams, 3 zones, 6 cards, 2 templates, 3 counters (one derived, one with a
 * supply role) in one conservation group, one meta schema with a reducer, a
 * roster reducer, policies and a hook binding table. Overrides replace
 * top-level members.
 */
export function buildDefinition(
  overrides: Partial<CompiledGameDefinition> = {},
): CompiledGameDefinition {
  const base: CompiledGameDefinition = {
    schemaVersion: 1,
    cards: ["c1", "c2", "c3", "c4", "c5", "c6"].map((id) => ({
      id: cid(id),
      type: "playing",
      metadataSchema: { rank: "int", suit: "string" },
      startingZone: zid("deck"),
    })),
    zones: [
      { id: zid("deck"), ordered: true },
      { id: zid("discard"), ordered: true },
      { id: zid("table"), ordered: false },
    ],
    zoneTemplates: [
      { name: "hand", ownerRule: "seat", ordered: false, maxInstances: 1 },
      { name: "pile", ownerRule: "none", ordered: true, maxInstances: 4 },
    ],
    counters: [
      { id: kid("pot"), owner: "table", min: 0n, initial: 0n },
      {
        id: kid("bank"),
        owner: "table",
        min: 0n,
        max: 1000n,
        initial: 100n,
        scale: 2,
        rounding: "half_even",
        supplyRole: "mint",
      },
      {
        id: kid("total"),
        owner: "table",
        min: 0n,
        initial: 0n,
        derived: () => 0n,
      },
    ],
    conservationGroups: [{ id: "chips", counters: [kid("pot"), kid("bank")] }],
    seats: [
      { id: sid("s1"), team: tid("t1") },
      { id: sid("s2"), team: tid("t2") },
    ],
    teams: [tid("t1"), tid("t2")],
    viewKeys: ["hand", "public"],
    control: {
      phases: ["setup", "play", "end"],
      initialPhase: "play",
      turnOrder: [sid("s1"), sid("s2")],
      initialActiveSeats: [sid("s1")],
      pointerNames: ["dealer"],
      enforceActiveSeats: true,
      outOfTurnKinds: ["chat"],
    },
    metaSchemas: [
      { id: "notes", fields: { text: "string" }, reducer: identity },
    ],
    rosterReducer: identity,
    policies: { cascadeCap: 16, costBudgets: { hooks: 100 } },
    hookBindings: { move: ["on-move"], "phase:play": ["on-play"] },
  };
  return { ...base, ...overrides };
}

const FLOOR_SEATS = 14;
const FLOOR_TEAMS = 4;
const FLOOR_CARDS = 700;
const FLOOR_ZONES = 64;

const pad = (n: number, width: number) => String(n).padStart(width, "0");

/** Definition at the Req NFR-020 floor: 14 seats, 4 teams, 700 cards, 64 zones. */
export function buildFloorDefinition(): CompiledGameDefinition {
  const seats = Array.from({ length: FLOOR_SEATS }, (_, i) => ({
    id: sid(`seat-${pad(i + 1, 2)}`),
    team: tid(`team-${(i % FLOOR_TEAMS) + 1}`),
  }));
  const zones = Array.from({ length: FLOOR_ZONES }, (_, i) => ({
    id: zid(`zone-${pad(i, 2)}`),
    ordered: i % 2 === 0,
  }));
  const cards = Array.from({ length: FLOOR_CARDS }, (_, i) => ({
    id: cid(`card-${pad(i, 3)}`),
    metadataSchema: { rank: "int" as const },
    startingZone: zid(`zone-${pad(i % FLOOR_ZONES, 2)}`),
  }));
  return buildDefinition({
    cards,
    zones,
    seats,
    teams: Array.from({ length: FLOOR_TEAMS }, (_, i) => tid(`team-${i + 1}`)),
    control: {
      phases: ["setup", "play", "end"],
      initialPhase: "play",
      turnOrder: seats.map((s) => s.id),
      initialActiveSeats: seats.slice(0, 1).map((s) => s.id),
      pointerNames: ["dealer"],
      enforceActiveSeats: true,
      outOfTurnKinds: [],
    },
  });
}
