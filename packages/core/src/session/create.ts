import { assertDefinitionStructure } from "../definition/assert.js";
import type { CompiledGameDefinition } from "../definition/types.js";
import { err, ok } from "../errors/result.js";
import type { Result } from "../errors/result.js";
import type { CardId, SeatId, SessionId, Seq, ZoneId } from "./ids.js";
import type { CounterId } from "./ids.js";
import { setOwn } from "./records.js";
import { deepFreeze } from "./snapshot.js";
import type { Snapshot } from "./snapshot.js";
import type {
  CardState,
  JsonValue,
  RosterEntry,
  RosterSeat,
  SessionState,
  ZoneState,
} from "./state.js";

function malformed(detail: string): Result<never> {
  return err({ code: "MALFORMED_ACTION", detail });
}

/** KFR-014: exactly one entry per declared seat, matching teams, no repeated player. */
function validateRoster(
  def: CompiledGameDefinition,
  roster: readonly RosterEntry[],
): Result<void> {
  const layout = new Map(def.seats.map((s) => [s.id as string, s]));
  const seen = new Set<string>();
  const players = new Set<string>();
  for (const entry of roster) {
    const seat = layout.get(entry.seat);
    if (seat === undefined) {
      return malformed(`roster names undeclared seat: ${entry.seat}`);
    }
    if (seen.has(entry.seat)) {
      return malformed(`roster has duplicate seat: ${entry.seat}`);
    }
    seen.add(entry.seat);
    if (entry.team !== undefined) {
      if (seat.team === undefined) {
        return malformed(
          `roster gives team ${entry.team} to seat ${entry.seat}, which the layout declares without a team`,
        );
      }
      if (entry.team !== seat.team) {
        return malformed(
          `roster team ${entry.team} for seat ${entry.seat} differs from the layout's team ${seat.team}`,
        );
      }
    }
    if (entry.player !== undefined) {
      if (players.has(entry.player)) {
        return malformed(`roster has duplicate player: ${entry.player}`);
      }
      players.add(entry.player);
    }
  }
  for (const seat of def.seats) {
    if (!seen.has(seat.id)) {
      return malformed(`roster is missing declared seat: ${seat.id}`);
    }
  }
  return ok(undefined);
}

/**
 * Builds the initial, deep-frozen state of a session (KFR-010). Runs
 * `assertDefinitionStructure` first and returns its error unchanged, then
 * validates the roster (KFR-014). Nothing is shared with `definition` or `roster`.
 * Initial `meta` holds an empty partition `{}` for every declared meta schema.
 */
export function createSession(
  definition: CompiledGameDefinition,
  sessionId: SessionId,
  roster: readonly RosterEntry[],
): Result<Snapshot<SessionState>> {
  const structure = assertDefinitionStructure(definition);
  if (!structure.ok) return structure;
  const rosterCheck = validateRoster(definition, roster);
  if (!rosterCheck.ok) return rosterCheck;

  const zoneMembers = new Map<string, CardId[]>(
    definition.zones.map((z) => [z.id, []]),
  );
  const cards: Record<CardId, CardState> = {};
  for (const card of definition.cards) {
    setOwn<CardState>(cards, card.id, {
      zone: card.startingZone,
      orientation: "face_down",
      metadata: { ...card.initialMetadata },
    });
    zoneMembers.get(card.startingZone)?.push(card.id);
  }
  const zones: Record<ZoneId, ZoneState> = {};
  for (const zone of definition.zones) {
    setOwn<ZoneState>(zones, zone.id, {
      ...(zone.owner !== undefined ? { owner: zone.owner } : {}),
      members: zoneMembers.get(zone.id) ?? [],
    });
  }

  const counters: Record<CounterId, bigint> = {};
  for (const counter of definition.counters) {
    if (counter.derived === undefined) {
      setOwn(counters, counter.id, counter.initial);
    }
  }

  const meta: Record<string, JsonValue> = {};
  for (const schema of definition.metaSchemas) setOwn(meta, schema.id, {});

  const seats: Record<SeatId, RosterSeat> = {};
  for (const entry of roster) {
    setOwn<RosterSeat>(seats, entry.seat, {
      status: "seated",
      ...(entry.player !== undefined ? { player: entry.player } : {}),
      ...(entry.team !== undefined ? { team: entry.team } : {}),
    });
  }

  const state: SessionState = {
    id: sessionId,
    lifecycle: "active",
    seq: 0 as Seq,
    cards,
    zones,
    zoneOrdinals: {},
    counters,
    meta,
    roster: { seats },
    control: {
      phase: definition.control.initialPhase,
      turnOrder: [...definition.control.turnOrder],
      activeSeats: [...definition.control.initialActiveSeats],
      direction: 1,
      pointers: {},
    },
    gates: { open: {}, resolved: {} },
    delegations: [],
    grants: {},
  };
  return ok(deepFreeze(state));
}
