import {
  arrayNode,
  bigintNode,
  boolNode,
  idMapNode,
  intNode,
  objectNode,
  optionalNode,
  stringNode,
} from "./schema.js";
import type { CanonicalSchema } from "./schema.js";

const strings = arrayNode(stringNode);

/**
 * Canonical schema of `DefinitionData` (the data portion of a definition, KFR-100/070):
 * function-valued members appear only as the booleans `derived`, `hasReducer` and
 * `hasRosterReducer`. Used to prove the data portion is serialisable; not part of the digest.
 */
export const definitionDataSchema: CanonicalSchema = objectNode([
  ["schemaVersion", intNode],
  [
    "cards",
    arrayNode(
      objectNode([
        ["id", stringNode],
        ["type", optionalNode(stringNode)],
        ["metadataSchema", idMapNode(stringNode)],
        ["startingZone", stringNode],
      ]),
    ),
  ],
  [
    "zones",
    arrayNode(
      objectNode([
        ["id", stringNode],
        ["ordered", boolNode],
      ]),
    ),
  ],
  [
    "zoneTemplates",
    arrayNode(
      objectNode([
        ["name", stringNode],
        ["ownerRule", stringNode],
        ["ordered", boolNode],
        ["maxInstances", intNode],
      ]),
    ),
  ],
  [
    "counters",
    arrayNode(
      objectNode([
        ["id", stringNode],
        ["owner", stringNode],
        ["min", bigintNode],
        ["max", optionalNode(bigintNode)],
        ["initial", bigintNode],
        ["scale", optionalNode(intNode)],
        ["rounding", optionalNode(stringNode)],
        ["supplyRole", optionalNode(stringNode)],
        ["derived", boolNode],
      ]),
    ),
  ],
  [
    "conservationGroups",
    arrayNode(
      objectNode([
        ["id", stringNode],
        ["counters", strings],
      ]),
    ),
  ],
  [
    "seats",
    arrayNode(
      objectNode([
        ["id", stringNode],
        ["team", optionalNode(stringNode)],
      ]),
    ),
  ],
  ["teams", strings],
  ["viewKeys", strings],
  [
    "control",
    objectNode([
      ["phases", strings],
      ["initialPhase", stringNode],
      ["turnOrder", strings],
      ["initialActiveSeats", strings],
      ["pointerNames", strings],
      ["enforceActiveSeats", boolNode],
      ["outOfTurnKinds", strings],
    ]),
  ],
  [
    "metaSchemas",
    arrayNode(
      objectNode([
        ["id", stringNode],
        ["fields", idMapNode(stringNode)],
        ["hasReducer", boolNode],
      ]),
    ),
  ],
  ["hasRosterReducer", boolNode],
  [
    "policies",
    objectNode([
      ["cascadeCap", intNode],
      ["costBudgets", idMapNode(intNode)],
    ]),
  ],
  ["hookBindings", idMapNode(strings)],
]);
