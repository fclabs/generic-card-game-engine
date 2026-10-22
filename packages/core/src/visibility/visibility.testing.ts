import { buildDefinition } from "../definition/definition.testing.js";
import type {
  CompiledGameDefinition,
  VisibilityRules,
} from "../definition/types.js";
import { playerId, seatId, sessionId, teamId, zoneId } from "../session/ids.js";
import type { SeatId } from "../session/ids.js";
import { createSession } from "../session/create.js";
import { must } from "../session/apply/apply.testing.js";
import type { Snapshot } from "../session/snapshot.js";
import type { RosterEntry, SessionState } from "../session/state.js";

export const seat = (v: string): SeatId => must(seatId(v));

/** North/South are team `ns` (players `pn`, `ps`), East/West are team `ew` (players `pe`, `pw`). */
export const FOUR_SEAT_ROSTER: readonly RosterEntry[] = [
  {
    seat: seat("north"),
    team: must(teamId("ns")),
    player: must(playerId("pn")),
  },
  {
    seat: seat("east"),
    team: must(teamId("ew")),
    player: must(playerId("pe")),
  },
  {
    seat: seat("south"),
    team: must(teamId("ns")),
    player: must(playerId("ps")),
  },
  {
    seat: seat("west"),
    team: must(teamId("ew")),
    player: must(playerId("pw")),
  },
];

/**
 * A valid four-seat definition (`buildDefinition` underneath) for role and
 * policy tests. `zoneVisibility` and `counterVisibility` replace the
 * visibility of every configured zone and counter; other overrides replace
 * top-level members. The trick-taking fixture of the projector tests is built
 * elsewhere (Iteration 2).
 */
export function buildRoleDefinition(
  overrides: Partial<CompiledGameDefinition> & {
    readonly zoneVisibility?: VisibilityRules;
    readonly counterVisibility?: VisibilityRules;
  } = {},
): CompiledGameDefinition {
  const { zoneVisibility = {}, counterVisibility = {}, ...rest } = overrides;
  const base = buildDefinition();
  const seats = FOUR_SEAT_ROSTER.map((r) => ({
    id: r.seat,
    ...(r.team !== undefined ? { team: r.team } : {}),
  }));
  return buildDefinition({
    zones: base.zones.map((z) => ({ ...z, visibility: zoneVisibility })),
    counters: base.counters.map((c) => ({
      ...c,
      visibility: counterVisibility,
    })),
    seats,
    teams: [must(teamId("ns")), must(teamId("ew"))],
    control: {
      ...base.control,
      turnOrder: seats.map((s) => s.id),
      initialActiveSeats: [seat("north")],
    },
    ...rest,
  });
}

/** A fresh active session over `def` with the four-seat roster. */
export function roleState(
  def: CompiledGameDefinition = buildRoleDefinition(),
): Snapshot<SessionState> {
  return must(createSession(def, must(sessionId("sess-1")), FOUR_SEAT_ROSTER));
}

export const zone = (v: string) => must(zoneId(v));
