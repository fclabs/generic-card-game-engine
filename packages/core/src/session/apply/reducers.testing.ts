import { buildDefinition } from "../../definition/definition.testing.js";
import type { CompiledGameDefinition } from "../../definition/types.js";
import type { Action } from "../actions.js";
import type { Reducer } from "../reducer.js";
import type { JsonValue, RosterState } from "../state.js";

/** `meta` action builder (plain strings; the validator brands nothing for meta). */
export function meta(schemaId: string, payload: JsonValue): Action {
  return { kind: "meta", schema_id: schemaId, payload };
}

/** `engine.<name>` action builder. */
export function engine(name: string, payload: JsonValue): Action {
  return meta(`engine.${name}`, payload);
}

/** Raw roster action (join/leave/substitute/set_status are routed to the roster reducer). */
export function rosterOp(
  op: string,
  fields: Record<string, JsonValue>,
): Action {
  return { kind: "roster", op, ...fields } as unknown as Action;
}

/** Merges the payload object into the partition (the default `notes` reducer). */
export const mergeReducer: Reducer<JsonValue> = (partition, payload) => ({
  ...(partition as { readonly [key: string]: JsonValue }),
  ...(payload as { readonly [key: string]: JsonValue }),
});

/**
 * Roster reducer for tests: `join`/`substitute` put `player_id` on `seat_id`, `set_status`
 * sets the seat's status; other ops return the partition unchanged.
 */
export const defaultRosterReducer: Reducer<RosterState> = (roster, payload) => {
  const op = payload as {
    readonly op: string;
    readonly seat_id?: string;
    readonly player_id?: string;
    readonly status?: string;
  };
  const seat = op.seat_id;
  const current = seat === undefined ? undefined : roster.seats[seat as never];
  if (seat === undefined || current === undefined) return roster;
  const seats = { ...roster.seats };
  Object.defineProperty(seats, seat, {
    enumerable: true,
    value:
      op.op === "set_status"
        ? { ...current, status: op.status }
        : { ...current, player: op.player_id },
  });
  return { seats };
};

export interface ReducerOverrides {
  readonly notes?: Reducer<JsonValue>;
  readonly roster?: Reducer<RosterState>;
  /** Reducer of the extra `blob {data: json}` schema. */
  readonly blob?: Reducer<JsonValue>;
  /** Reducer of the extra `score {points: int}` schema. */
  readonly score?: Reducer<JsonValue>;
}

/**
 * The default fixture plus three meta schemas (`notes {text: string}`, `score {points: int}`,
 * `blob {data: json}`) and a roster reducer. Each reducer can be replaced to build a
 * misbehaving definition.
 */
export function buildReducerDefinition(
  over: ReducerOverrides = {},
): CompiledGameDefinition {
  return buildDefinition({
    metaSchemas: [
      {
        id: "notes",
        fields: { text: "string" },
        reducer: over.notes ?? mergeReducer,
      },
      {
        id: "score",
        fields: { points: "int" },
        reducer: over.score ?? mergeReducer,
      },
      {
        id: "blob",
        fields: { data: "json" },
        reducer: over.blob ?? mergeReducer,
      },
    ],
    rosterReducer: over.roster ?? defaultRosterReducer,
  });
}
