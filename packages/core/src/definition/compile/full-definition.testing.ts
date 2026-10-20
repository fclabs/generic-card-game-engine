import type { HookBundleInfo } from "./references.js";

/**
 * The fully populated `game.yaml` of spec section 7.1, as the parsed value
 * (VC-210). Exercises every key of every section.
 */
export const FULL_DEFINITION: Record<string, unknown> = {
  id: "hearts",
  action_schema_version: 1,
  roles: [{ id: "spectator", subject: "forbidden" }],
  seats: {
    list: [
      { id: "north", team: "ns" },
      { id: "east", team: "ew" },
      { id: "south", team: "ns" },
      { id: "west", team: "ew" },
    ],
    teams: ["ns", "ew"],
  },
  zones: [
    { id: "stock", ordering: "ordered", visibility: { default: "hidden" } },
    {
      id: "hand-{seat}",
      for_each: "seat",
      owner_id: "{seat}",
      ordering: "unordered",
      visibility: { default: "hidden", player: "owner", spectator: "public" },
    },
    { template: "meld", owner: "team", ordering: "ordered", max_instances: 8 },
  ],
  cards: [
    {
      generate: {
        axes: [
          { name: "suit", values: ["S", "H", "D", "C"] },
          { name: "rank", values: { range: [1, 13] } },
        ],
        id: "{suit}{rank}",
        type: "{suit}",
        zone: "stock",
        metadata: { suit: "{suit}", rank: "{rank}" },
        metadata_schema: {
          suit: { type: "string", visibility: "public" },
          rank: { type: "int", visibility: "public" },
        },
      },
    },
    { id: "joker", zone: "stock" },
  ],
  counters: [
    {
      id: "pot",
      owner: "table",
      min: 0,
      initial: 0,
      visibility: { default: "public" },
    },
    {
      id: "chips-{seat}",
      for_each: "seat",
      owner: "player",
      owner_id: "{seat}",
      min: 0,
      max: "1000000000000000000000",
      initial: 100,
      scale: 2,
      rounding: "half_even",
    },
    { id: "bank", owner: "table", min: 0, initial: 0, supply_role: "mint" },
    {
      id: "stock_size",
      derived: { zone_size: "stock" },
      visibility: { default: "public" },
    },
  ],
  conservation_groups: [
    {
      id: "money",
      counters: ["pot", { expand: "chips-{seat}", for_each: "seat" }],
    },
  ],
  control: {
    phases: ["deal", "play"],
    initial_phase: "deal",
    turn_order: ["north", "east", "south", "west"],
    initial_active_seats: ["north"],
    pointers: ["button"],
    enforce_active_seats: true,
    out_of_turn: ["chat"],
  },
  meta_schemas: [
    {
      id: "hearts.score",
      reducer: "reduceScore",
      fields: {
        points: { type: "int", visibility: "public" },
        note: { type: "string", visibility: "secret" },
      },
    },
  ],
  roster_reducer: "reduceRoster",
  view_keys: ["card_face", "zone_membership"],
  hooks: {
    module: "./hooks.ts",
    validation: { play_card: "validatePlay" },
    reaction: { "phase:play": ["onTrickComplete"], "trigger:setup": "setup" },
    gate_resolve: { "hearts.pass": "resolvePass" },
    authorization: ["authorize"],
  },
  policies: {
    cascade_cap: 16,
    cost_budgets: { validation: 500000, reaction: 2000000 },
  },
};

/** Bundle whose exports cover every reference of `FULL_DEFINITION`. */
export const FULL_BUNDLE: HookBundleInfo = {
  hash: "bundle-hash",
  exports: [
    "authorize",
    "onTrickComplete",
    "reduceRoster",
    "reduceScore",
    "resolvePass",
    "setup",
    "validatePlay",
  ],
};
