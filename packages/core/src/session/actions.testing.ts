import type { Result } from "../errors/result.js";
import type {
  Action,
  CounterAdjustAction,
  CounterTransferAction,
  DrawMacro,
  FlipAction,
  LifecycleAction,
  MoveAction,
  SetMetadataAction,
  ShuffleAction,
} from "./actions.js";
import { cardId, counterId, zoneId } from "./ids.js";
import type { JsonValue, Lifecycle, Orientation } from "./state.js";

function must<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error.detail);
  return result.value;
}
const c = (v: string) => must(cardId(v));
const z = (v: string) => must(zoneId(v));
const k = (v: string) => must(counterId(v));

/** Test-only action builders taking plain strings (the branded ids are made here). */
export const A = {
  move(card: string, from: string, to: string, position?: number): MoveAction {
    return {
      kind: "move",
      card_id: c(card),
      from_zone: z(from),
      to_zone: z(to),
      ...(position !== undefined ? { to_position: position } : {}),
    };
  },
  flip(card: string, orientation: Orientation): FlipAction {
    return { kind: "flip", card_id: c(card), orientation };
  },
  shuffle(zone: string, permutation: readonly string[]): ShuffleAction {
    return { kind: "shuffle", zone: z(zone), permutation: permutation.map(c) };
  },
  setMetadata(
    card: string,
    fields: { readonly [name: string]: JsonValue },
  ): SetMetadataAction {
    return { kind: "set_metadata", card_id: c(card), fields };
  },
  lifecycle(to: Lifecycle, outcome?: JsonValue): LifecycleAction {
    return {
      kind: "lifecycle",
      to_state: to,
      ...(outcome !== undefined ? { outcome } : {}),
    };
  },
  adjust(
    counter: string,
    delta: bigint,
    ratio?: [bigint, bigint],
  ): CounterAdjustAction {
    return {
      kind: "counter_adjust",
      counter_id: k(counter),
      delta,
      ...(ratio ? { ratio: { num: ratio[0], den: ratio[1] } } : {}),
    };
  },
  transfer(
    from: string,
    to: string,
    amount: bigint,
    opts: { ratio?: [bigint, bigint]; remainderTo?: string } = {},
  ): CounterTransferAction {
    return {
      kind: "counter_transfer",
      from_counter: k(from),
      to_counter: k(to),
      amount,
      ...(opts.ratio
        ? { ratio: { num: opts.ratio[0], den: opts.ratio[1] } }
        : {}),
      ...(opts.remainderTo ? { remainder_to: k(opts.remainderTo) } : {}),
    };
  },
  draw(from: string, count: number, to: string, position?: number): DrawMacro {
    return {
      kind: "draw",
      from_zone: z(from),
      count,
      to_zone: z(to),
      ...(position !== undefined ? { to_position: position } : {}),
    };
  },
} as const;

/** Stable text of actions for comparisons (JSON has no bigint). */
export function actionsText(actions: readonly Action[]): string {
  return JSON.stringify(actions, (_k, v: unknown) =>
    typeof v === "bigint" ? `${v.toString()}n` : v,
  );
}

/** One valid wire sample per kind (roster per op). */
export const SAMPLES: readonly Record<string, unknown>[] = [
  { kind: "move", card_id: "c1", from_zone: "deck", to_zone: "table" },
  {
    kind: "move",
    card_id: "c1",
    from_zone: "deck",
    to_zone: "discard",
    to_position: 0,
  },
  { kind: "flip", card_id: "c1", orientation: "face_up" },
  { kind: "shuffle", zone: "deck", permutation: ["c1", "c2"] },
  { kind: "set_metadata", card_id: "c1", fields: { rank: 3, suit: "h" } },
  { kind: "lifecycle", to_state: "completed", outcome: { winner: "s1" } },
  {
    kind: "counter_adjust",
    counter_id: "pot",
    delta: 5n,
    ratio: { num: 1n, den: 3n },
  },
  {
    kind: "counter_transfer",
    from_counter: "pot",
    to_counter: "bank",
    amount: 7n,
    remainder_to: "pot",
  },
  {
    kind: "control_set",
    phase: "play",
    active_seats: ["s1"],
    direction: -1,
    pointer: { name: "dealer", seat: "s1" },
  },
  { kind: "control_advance", steps: 2, pointer: "dealer" },
  {
    kind: "grant_view",
    target: { kind: "card", card_id: "c1" },
    keys: ["hand"],
    grantee: "s1",
    scope: { kind: "once" },
  },
  { kind: "revoke_view", grant_id: "grant/1/0" },
  { kind: "zone_create", template: "hand", owner: "s1" },
  { kind: "zone_destroy", zone_id: "hand/s1/1" },
  { kind: "roster", op: "join", player_id: "p1", team_id: "t1" },
  { kind: "roster", op: "leave", player_id: "p1" },
  { kind: "roster", op: "substitute", player_id: "p2", seat_id: "s1" },
  { kind: "roster", op: "set_status", seat_id: "s1", status: "sitting_out" },
  {
    kind: "roster",
    op: "delegate",
    seat_id: "s1",
    grantee_principal: "alice",
    scope: null,
  },
  {
    kind: "roster",
    op: "revoke_delegation",
    seat_id: "s1",
    grantee_principal: "alice",
  },
  { kind: "meta", schema_id: "notes", payload: { text: "x" } },
  {
    kind: "meta",
    schema_id: "engine.gate_open",
    payload: [1, "a", true, null],
  },
  { kind: "draw", from_zone: "deck", count: 0, to_zone: "table" },
  { kind: "zone_merge", src_zone: "a/s1/1", dst_zone: "a/s1/2" },
  { kind: "reset_to_zone", zones: ["deck", "discard"], to_zone: "table" },
];
