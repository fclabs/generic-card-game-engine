/**
 * Test-only: a session at the Req NFR-020 floor (14 seats, 4 teams, 700 cards, 64 zones,
 * 40 counters) with real visibility declarations, for the Phase 3 performance tests (VC-373).
 * Zones 0..13 are the seats' hands (owner-visible, auditor public), 14..39 are public, 40..63
 * are hidden (dealer public). Counters 0..13 are owner-visible, 14..37 public, 38 and 39 derived
 * (public sizes of zone-40 and zone-41). All public-zone cards are face up.
 */
import { buildFloorDefinition } from "../definition/definition.testing.js";
import type { CompiledGameDefinition } from "../definition/types.js";
import { A } from "../session/actions.testing.js";
import { must } from "../session/apply/apply.testing.js";
import { apply } from "../session/apply/index.js";
import { createSession } from "../session/create.js";
import {
  cardId,
  counterId,
  seatId,
  sessionId,
  zoneId,
} from "../session/ids.js";
import type { Snapshot } from "../session/snapshot.js";
import type { RosterEntry, SessionState } from "../session/state.js";

const pad = (n: number, w: number) => String(n).padStart(w, "0");
const zid = (v: string) => must(zoneId(v));

export interface FloorSession {
  readonly def: CompiledGameDefinition;
  readonly roster: readonly RosterEntry[];
  /** The fresh session (seq 0, all cards face down). */
  readonly initial: Snapshot<SessionState>;
  /** `initial` after one batch flipping every public-zone card face up (seq 1). */
  readonly state: Snapshot<SessionState>;
}

export function buildVisibilityFloor(): FloorSession {
  const base = buildFloorDefinition();
  const seatIds = base.seats.map((s) => s.id);
  const def: CompiledGameDefinition = {
    ...base,
    viewKeys: ["card_face", "zone_membership", "zone_count", "zone_order"],
    zones: base.zones.map((z, i) => ({
      ...z,
      ...(i < 14 ? { owner: seatIds[i] } : {}),
      visibility:
        i < 14
          ? ({ default: "hidden", player: "owner", auditor: "public" } as const)
          : i < 40
            ? ({ default: "public" } as const)
            : ({ default: "hidden", dealer: "public" } as const),
    })),
    cards: base.cards.map((c, i) => ({
      ...c,
      id: must(cardId(`card-${pad(i, 3)}`)),
      type: "playing",
      metadataSchema: {
        rank: "int" as const,
        suit: "string" as const,
        key: "string" as const,
      },
      initialMetadata: {
        rank: i % 13,
        suit: "spades",
        key: `secret-${String(i)}`,
      },
      metadataVisibility: {
        rank: "public" as const,
        suit: "subject" as const,
        key: "secret" as const,
      },
    })),
    counters: Array.from({ length: 40 }, (_, i) => {
      const id = must(counterId(`ctr-${pad(i, 2)}`));
      const common = { id, min: 0n, initial: 1000n + BigInt(i) };
      if (i >= 38) {
        const zone = zid(`zone-${String(40 + i - 38)}`);
        return {
          ...common,
          owner: "table" as const,
          visibility: { default: "public" } as const,
          derived: (s: Snapshot<SessionState>) =>
            BigInt(s.zones[zone]?.members.length ?? 0),
          derivedSpec: { kind: "zone_size" as const, zone },
        };
      }
      return i < 14
        ? {
            ...common,
            owner: "player" as const,
            ownerId: seatIds[i] as string,
            visibility: { player: "owner" } as const,
          }
        : {
            ...common,
            owner: "table" as const,
            visibility: { default: "public" } as const,
          };
    }),
    conservationGroups: [],
  };
  const roster: RosterEntry[] = def.seats.map((s) => ({
    seat: must(seatId(s.id)),
    ...(s.team !== undefined ? { team: s.team } : {}),
  }));
  const initial = must(createSession(def, must(sessionId("floor-1")), roster));
  const flips = Object.keys(initial.cards)
    .filter((id) => {
      const zone = Number(initial.cards[id as never]?.zone.slice(5));
      return zone >= 14 && zone < 40;
    })
    .map((id) => A.flip(id, "face_up"));
  const state = must(apply(def, initial, flips)).state;
  return { def, roster, initial, state };
}
