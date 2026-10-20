import { compileDefinition } from "./compile.js";
import type { DefinitionError } from "./errors.js";

/** Minimal valid document; `over` replaces or adds top-level sections. */
export const doc = (
  over: Record<string, unknown> = {},
): Record<string, unknown> => ({
  id: "hearts",
  action_schema_version: 1,
  seats: { count: 4 },
  ...over,
});

export function failure(raw: unknown): readonly DefinitionError[] {
  const r = compileDefinition(raw);
  if (r.ok) throw new Error("expected failure");
  return r.errors;
}

export function success(raw: unknown) {
  const r = compileDefinition(raw);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.value;
}

/** `[code, path]` pairs, for compact assertions. */
export const codePaths = (errors: readonly DefinitionError[]) =>
  errors.map((e) => [e.code, e.path] as const);

export const STOCK = { id: "stock", ordering: "ordered" };

/** The `suit x rank` generator of spec section 7.1. */
export const SUIT_RANK_GENERATOR = {
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
};

/** A document with the stock zone and the 52-card generator. */
export const deckDoc = (over: Record<string, unknown> = {}) =>
  doc({ zones: [STOCK], cards: [SUIT_RANK_GENERATOR], ...over });
