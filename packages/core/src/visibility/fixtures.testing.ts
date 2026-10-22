import { buildDefinition } from "../definition/definition.testing.js";
import type { CompiledGameDefinition } from "../definition/types.js";
import { must } from "../session/apply/apply.testing.js";
import { apply } from "../session/apply/index.js";
import { A } from "../session/actions.testing.js";
import type { Action } from "../session/actions.js";
import { cardId, counterId, teamId, zoneId } from "../session/ids.js";
import type { Snapshot } from "../session/snapshot.js";
import type { SessionState } from "../session/state.js";
import { FOUR_SEAT_ROSTER, roleState, seat } from "./visibility.testing.js";

/** Seats in turn order; teams ns (north, south) and ew (east, west). */
export const TRICK_SEATS = ["north", "east", "south", "west"] as const;

/**
 * Four-seat trick-taking definition (reducers bound in code, as P1 fixtures):
 * - zones `hand-<seat>` (unordered, owned by the seat, visibility
 *   `{default: hidden, player: owner}`), `trick` and `discard` (ordered,
 *   `{default: public}`), `stock` (ordered, `{default: hidden}`);
 * - cards `<seat>-1`, `<seat>-2` in each hand, `t1`, `t2` in the trick, `d1`
 *   in the discard, `k1`..`k3` in the stock; all start face down; metadata
 *   `suit` (public), `own` (subject), `key` (secret), `extra` (undeclared);
 * - counters `pot` (public), `chips-<seat>` (owner), derived `stock_size`
 *   (public, over the hidden stock).
 * Overrides replace top-level members.
 */
export function buildTrickTakingDefinition(
  overrides: Partial<CompiledGameDefinition> = {},
): CompiledGameDefinition {
  const zid = (v: string) => must(zoneId(v));
  const kid = (v: string) => must(counterId(v));
  const place = (zone: string, ids: readonly string[]) =>
    ids.map((id) => ({
      id: must(cardId(id)),
      type: "playing",
      metadataSchema: {
        suit: "string" as const,
        own: "int" as const,
        key: "string" as const,
        extra: "string" as const,
      },
      startingZone: zid(zone),
      initialMetadata: { suit: "hearts", own: 7, key: "k-secret", extra: "x" },
      metadataVisibility: {
        suit: "public" as const,
        own: "subject" as const,
        key: "secret" as const,
      },
    }));
  const cards = [
    ...TRICK_SEATS.flatMap((s) => place(`hand-${s}`, [`${s}-1`, `${s}-2`])),
    ...place("trick", ["t1", "t2"]),
    ...place("discard", ["d1"]),
    ...place("stock", ["k1", "k2", "k3"]),
  ];
  const base = buildDefinition();
  const seats = FOUR_SEAT_ROSTER.map((r) => ({
    id: r.seat,
    ...(r.team !== undefined ? { team: r.team } : {}),
  }));
  return buildDefinition({
    cards,
    zones: [
      ...TRICK_SEATS.map((s) => ({
        id: zid(`hand-${s}`),
        ordered: false,
        owner: seat(s),
        visibility: { default: "hidden", player: "owner" } as const,
      })),
      {
        id: zid("trick"),
        ordered: true,
        visibility: { default: "public" } as const,
      },
      {
        id: zid("discard"),
        ordered: true,
        visibility: { default: "public" } as const,
      },
      {
        id: zid("stock"),
        ordered: true,
        visibility: { default: "hidden" } as const,
      },
    ],
    zoneTemplates: [],
    counters: [
      {
        id: kid("pot"),
        owner: "table",
        visibility: { default: "public" },
        min: 0n,
        initial: 0n,
      },
      ...TRICK_SEATS.map((s) => ({
        id: kid(`chips-${s}`),
        owner: "player" as const,
        ownerId: s,
        visibility: { player: "owner" } as const,
        min: 0n,
        initial: 100n,
      })),
      {
        id: kid("stock_size"),
        owner: "table",
        visibility: { default: "public" },
        min: 0n,
        initial: 0n,
        derived: (s: Snapshot<SessionState>) =>
          BigInt(s.zones[zid("stock")]?.members.length ?? 0),
        derivedSpec: { kind: "zone_size", zone: zid("stock") },
      },
    ],
    conservationGroups: [],
    seats,
    teams: [must(teamId("ns")), must(teamId("ew"))],
    control: {
      ...base.control,
      turnOrder: seats.map((s) => s.id),
      initialActiveSeats: [seat("north")],
    },
    ...overrides,
  });
}

/**
 * A fresh session over `def` (default: the trick-taking definition) with the
 * four-seat roster; `t1` and `d1` are flipped face up (`t2`, the hands and the
 * stock stay face down). `extra` actions are applied afterwards.
 */
export function trickTakingState(
  def: CompiledGameDefinition = buildTrickTakingDefinition(),
  extra: readonly Action[] = [],
): Snapshot<SessionState> {
  const start = roleState(def);
  return must(
    apply(def, start, [
      A.flip("t1", "face_up"),
      A.flip("d1", "face_up"),
      ...extra,
    ]),
  ).state;
}
