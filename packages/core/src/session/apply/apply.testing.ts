import { buildDefinition } from "../../definition/definition.testing.js";
import type { CompiledGameDefinition } from "../../definition/types.js";
import type { EngineError, Result } from "../../errors/result.js";
import { playerId, seatId, sessionId, teamId } from "../ids.js";
import { createSession } from "../create.js";
import type { Snapshot } from "../snapshot.js";
import type { RosterEntry, SessionState } from "../state.js";

export function must<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

/** The error of a result that must have failed. */
export function errorOf<T>(result: Result<T>): EngineError {
  if (result.ok) throw new Error("expected an error result");
  return result.error;
}

/** Roster for the default fixture: s1 (team t1) with player p1, s2 (team t2). */
export function defaultRoster(): RosterEntry[] {
  return [
    {
      seat: must(seatId("s1")),
      player: must(playerId("p1")),
      team: must(teamId("t1")),
    },
    { seat: must(seatId("s2")), team: must(teamId("t2")) },
  ];
}

/** A fresh active session over `def` (default fixture: deck c1..c6, discard and table empty). */
export function startState(
  def: CompiledGameDefinition = buildDefinition(),
  roster: readonly RosterEntry[] = defaultRoster(),
): Snapshot<SessionState> {
  return must(createSession(def, must(sessionId("sess-1")), roster));
}
