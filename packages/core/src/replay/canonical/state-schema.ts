import type {
  CompiledGameDefinition,
  FieldSchema,
  FieldType,
} from "../../definition/types.js";
import type { Snapshot } from "../../session/snapshot.js";
import type { SessionState } from "../../session/state.js";
import { canonicalize } from "./canonicalize.js";
import { sha256Hex } from "./sha256.js";
import {
  arrayNode,
  bigintNode,
  boolNode,
  idMapNode,
  intNode,
  jsonNode,
  objectNode,
  optionalNode,
  stringNode,
} from "./schema.js";
import type { CanonicalSchema } from "./schema.js";

function fieldNode(type: FieldType): CanonicalSchema {
  switch (type) {
    case "string":
      return stringNode;
    case "int":
      return intNode;
    case "bool":
      return boolNode;
    case "json":
      return jsonNode;
  }
}

/**
 * One object node covering every declared field of `schemas` (names sorted by UTF-16 code
 * unit, every field optional because `set_metadata` and reducers fill fields incrementally).
 * A name declared with different types in different schemas becomes `json`, which emits
 * the same bytes for strings, safe integers and booleans.
 */
function unionFieldsNode(schemas: readonly FieldSchema[]): CanonicalSchema {
  const types = new Map<string, FieldType>();
  for (const schema of schemas) {
    for (const [name, type] of Object.entries(schema)) {
      const known = types.get(name);
      types.set(name, known === undefined || known === type ? type : "json");
    }
  }
  const names = [...types.keys()].sort();
  return objectNode(
    names.map(
      (name) =>
        [name, optionalNode(fieldNode(types.get(name) ?? "json"))] as const,
    ),
  );
}

/** Canonical schema of the `roster` partition (also used to validate roster reducer output). */
export const rosterNode: CanonicalSchema = objectNode([
  [
    "seats",
    idMapNode(
      objectNode([
        ["status", stringNode],
        ["player", optionalNode(stringNode)],
        ["team", optionalNode(stringNode)],
      ]),
    ),
  ],
]);

/** Canonical schema of one `meta` partition: the declared fields, each optional. */
export function metaPartitionNode(fields: FieldSchema): CanonicalSchema {
  return unionFieldsNode([fields]);
}

const gateNode: CanonicalSchema = objectNode([
  ["schemaId", stringNode],
  ["expectedSeats", arrayNode(stringNode)],
  ["submissions", idMapNode(jsonNode)],
]);

/**
 * The canonical schema of a session state under `definition` (spec §6.2 rule 2, §6.4):
 * field order is the §6.4 order with `derivedCounters` right after `counters` and `id`
 * excluded. Card metadata and meta partitions use the definition's declared field schemas
 * (unioned across cards / meta schemas, because an `idMap` has one value node).
 */
export function buildStateSchema(
  definition: CompiledGameDefinition,
): CanonicalSchema {
  return objectNode([
    ["lifecycle", stringNode],
    ["seq", intNode],
    [
      "cards",
      idMapNode(
        objectNode([
          ["zone", stringNode],
          ["orientation", stringNode],
          [
            "metadata",
            unionFieldsNode(definition.cards.map((c) => c.metadataSchema)),
          ],
        ]),
      ),
    ],
    [
      "zones",
      idMapNode(
        objectNode([
          ["template", optionalNode(stringNode)],
          ["owner", optionalNode(stringNode)],
          ["members", arrayNode(stringNode)],
        ]),
      ),
    ],
    ["zoneOrdinals", idMapNode(intNode)],
    ["counters", idMapNode(bigintNode)],
    ["derivedCounters", idMapNode(bigintNode)],
    [
      "meta",
      idMapNode(unionFieldsNode(definition.metaSchemas.map((m) => m.fields))),
    ],
    ["roster", rosterNode],
    [
      "control",
      objectNode([
        ["phase", stringNode],
        ["turnOrder", arrayNode(stringNode)],
        ["activeSeats", arrayNode(stringNode)],
        ["direction", intNode],
        ["pointers", idMapNode(stringNode)],
      ]),
    ],
    [
      "gates",
      objectNode([
        ["open", idMapNode(gateNode)],
        ["resolved", idMapNode(gateNode)],
      ]),
    ],
    [
      "delegations",
      arrayNode(
        objectNode([
          ["seat", stringNode],
          ["principal", stringNode],
          ["scope", optionalNode(jsonNode)],
          ["boundary", optionalNode(stringNode)],
        ]),
      ),
    ],
    [
      "grants",
      idMapNode(
        objectNode([
          ["target", jsonNode],
          ["keys", arrayNode(stringNode)],
          ["grantee", stringNode],
          ["scope", jsonNode],
        ]),
      ),
    ],
    ["outcome", optionalNode(jsonNode)],
  ]);
}

/** Evaluates every derived counter against `state`; a bad evaluator is a programmer error (plain `Error`). */
function computeDerivedCounters(
  definition: CompiledGameDefinition,
  state: Snapshot<SessionState>,
): Record<string, bigint> {
  const out: Record<string, bigint> = {};
  for (const counter of definition.counters) {
    if (counter.derived === undefined) continue;
    let value: unknown;
    try {
      value = counter.derived(state);
    } catch (cause) {
      throw new Error(`derived counter ${counter.id}: evaluator threw`, {
        cause,
      });
    }
    if (typeof value !== "bigint") {
      throw new Error(
        `derived counter ${counter.id}: evaluator returned a non-bigint (${typeof value})`,
      );
    }
    out[counter.id] = value;
  }
  return out;
}

/** The serialisable view of a state: no `id`, `derivedCounters` computed, no `undefined` values. */
function stateView(
  definition: CompiledGameDefinition,
  state: Snapshot<SessionState>,
): Record<string, unknown> {
  return {
    lifecycle: state.lifecycle,
    seq: state.seq,
    cards: state.cards,
    zones: state.zones,
    zoneOrdinals: state.zoneOrdinals,
    counters: state.counters,
    derivedCounters: computeDerivedCounters(definition, state),
    meta: state.meta,
    roster: state.roster,
    control: state.control,
    gates: state.gates,
    delegations: state.delegations,
    grants: state.grants,
    ...(state.outcome !== undefined ? { outcome: state.outcome } : {}),
  };
}

/** Canonical bytes of a state (KFR-071); exposed within core for tests and the digest. */
export function canonicalStateBytes(
  definition: CompiledGameDefinition,
  state: Snapshot<SessionState>,
): Uint8Array {
  return canonicalize(
    buildStateSchema(definition),
    stateView(definition, state),
  );
}

/**
 * Lower-case hex SHA-256 of the canonical state serialisation (KFR-071). The session `id`
 * is excluded. Derived counters are computed on demand from `definition`. Throws
 * `CanonicalError` when the state does not fit the schema and a plain `Error` when a
 * derived-counter evaluator throws or returns a non-bigint (programmer errors).
 */
export function stateDigest(
  definition: CompiledGameDefinition,
  state: Snapshot<SessionState>,
): string {
  return sha256Hex(canonicalStateBytes(definition, state));
}
