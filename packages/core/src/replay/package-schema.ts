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
} from "./canonical/schema.js";
import type { CanonicalSchema } from "./canonical/schema.js";

/**
 * The `CanonicalSchema` of a `ReplayPackage` (format v1, spec PFR-033). Field order is the
 * canonical key order of the package.
 *
 * The schema is **definition-independent** (decision D-026): the package header, the log and
 * the receipts are fully typed, and `initial` uses {@link packageStateNode}, the state schema
 * of `buildStateSchema` with `json` nodes where that schema consults the definition (card
 * metadata, meta partitions). `json` and the typed field nodes emit the same bytes for the
 * values the engine produces (strings, safe integers, booleans, null, arrays, objects with
 * sorted keys), so encoding does not depend on the definition; decoding yields the same
 * values. Whether `initial` fits the definition's declared fields is checked by the replayer
 * (its digest is computed under the definition's own schema, PFR-042).
 */

const idArray = arrayNode(stringNode);

/**
 * One node for every primitive action kind: `kind` first, then every payload field of any
 * kind, sorted, all optional (the canonical profile has no tagged union). Counter amounts and
 * ratio terms are `bigint` (decimal strings). The replayer, not the schema, checks that an
 * action is a well-formed logged primitive (PFR-043).
 */
export const actionNode: CanonicalSchema = objectNode([
  ["kind", stringNode],
  ["active_seats", optionalNode(idArray)],
  ["amount", optionalNode(bigintNode)],
  ["boundary", optionalNode(stringNode)],
  ["card_id", optionalNode(stringNode)],
  ["counter_id", optionalNode(stringNode)],
  ["delta", optionalNode(bigintNode)],
  ["direction", optionalNode(intNode)],
  ["fields", optionalNode(jsonNode)],
  ["from_counter", optionalNode(stringNode)],
  ["from_zone", optionalNode(stringNode)],
  ["grant_id", optionalNode(stringNode)],
  ["grantee", optionalNode(stringNode)],
  ["grantee_principal", optionalNode(stringNode)],
  ["keys", optionalNode(idArray)],
  ["mode", optionalNode(stringNode)],
  ["op", optionalNode(stringNode)],
  ["orientation", optionalNode(stringNode)],
  ["outcome", optionalNode(jsonNode)],
  ["owner", optionalNode(stringNode)],
  ["payload", optionalNode(jsonNode)],
  ["permutation", optionalNode(idArray)],
  ["phase", optionalNode(stringNode)],
  ["player_id", optionalNode(stringNode)],
  ["pointer", optionalNode(jsonNode)],
  [
    "ratio",
    optionalNode(
      objectNode([
        ["num", bigintNode],
        ["den", bigintNode],
      ]),
    ),
  ],
  ["remainder_to", optionalNode(stringNode)],
  ["schema_id", optionalNode(stringNode)],
  ["scope", optionalNode(jsonNode)],
  ["seat_id", optionalNode(stringNode)],
  ["status", optionalNode(stringNode)],
  ["steps", optionalNode(intNode)],
  ["target", optionalNode(jsonNode)],
  ["team_id", optionalNode(stringNode)],
  ["template", optionalNode(stringNode)],
  ["to_counter", optionalNode(stringNode)],
  ["to_position", optionalNode(intNode)],
  ["to_state", optionalNode(stringNode)],
  ["to_zone", optionalNode(stringNode)],
  ["zone", optionalNode(stringNode)],
  ["zone_id", optionalNode(stringNode)],
  ["zones_to_create", optionalNode(idArray)],
]);

const gateNode: CanonicalSchema = objectNode([
  ["schemaId", stringNode],
  ["expectedSeats", idArray],
  ["submissions", idMapNode(jsonNode)],
]);

/**
 * `SessionState` as it travels in a package: the field order of the digest schema
 * (`buildStateSchema`) with `id` first (a package carries the full state), no
 * `derivedCounters` (computed, never stored) and definition-independent value nodes.
 */
export const packageStateNode: CanonicalSchema = objectNode([
  ["id", stringNode],
  ["lifecycle", stringNode],
  ["seq", intNode],
  [
    "cards",
    idMapNode(
      objectNode([
        ["zone", stringNode],
        ["orientation", stringNode],
        ["metadata", jsonNode],
      ]),
    ),
  ],
  [
    "zones",
    idMapNode(
      objectNode([
        ["template", optionalNode(stringNode)],
        ["owner", optionalNode(stringNode)],
        ["members", idArray],
      ]),
    ),
  ],
  ["zoneOrdinals", idMapNode(intNode)],
  ["counters", idMapNode(bigintNode)],
  ["meta", idMapNode(jsonNode)],
  [
    "roster",
    objectNode([
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
    ]),
  ],
  [
    "control",
    objectNode([
      ["phase", stringNode],
      ["turnOrder", idArray],
      ["activeSeats", idArray],
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
        ["keys", idArray],
        ["grantee", stringNode],
        ["scope", jsonNode],
      ]),
    ),
  ],
  ["outcome", optionalNode(jsonNode)],
]);

const receiptNode: CanonicalSchema = objectNode([
  ["fingerprint", stringNode],
  ["result", jsonNode],
  ["errorCode", jsonNode],
  ["seq", jsonNode],
  ["detail", jsonNode],
  ["privileged", boolNode],
]);

/** `ReplayPackage` format v1, in the field order of PFR-033. */
export const replayPackageSchema: CanonicalSchema = objectNode([
  ["formatVersion", intNode],
  ["sessionId", stringNode],
  [
    "definition",
    objectNode([
      ["id", stringNode],
      ["gameId", stringNode],
      ["contentHash", stringNode],
    ]),
  ],
  ["actionSchemaVersion", intNode],
  ["initial", packageStateNode],
  ["params", jsonNode],
  [
    "log",
    arrayNode(
      objectNode([
        ["seq", intNode],
        ["eventId", stringNode],
        ["principal", stringNode],
        ["actions", arrayNode(actionNode)],
      ]),
    ),
  ],
  [
    "receipts",
    arrayNode(
      objectNode([
        ["principal", stringNode],
        ["eventId", stringNode],
        ["receipt", receiptNode],
      ]),
    ),
  ],
  [
    "digests",
    arrayNode(
      objectNode([
        ["seq", intNode],
        ["digest", stringNode],
      ]),
    ),
  ],
  [
    "forkedFrom",
    optionalNode(
      objectNode([
        ["sessionId", stringNode],
        ["seq", intNode],
      ]),
    ),
  ],
]);
