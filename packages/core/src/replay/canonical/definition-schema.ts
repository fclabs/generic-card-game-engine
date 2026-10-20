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

const strings = arrayNode(stringNode);
const visibilityRules = idMapNode(stringNode);

/**
 * Identity schema of `DefinitionData` (DFR-066): covers every field of the compiled definition's
 * data portion. Function-valued members never appear; identity is carried by `derivedSpec`,
 * `reducerRef` and `rosterReducerRef`. Fields added in Phase 2 (spec §7.2) are appended to each
 * object in the order §7.2 lists them. The canonical profile rules themselves are unchanged.
 */
export const definitionIdentitySchema: CanonicalSchema = objectNode([
  ["schemaVersion", intNode],
  [
    "cards",
    arrayNode(
      objectNode([
        ["id", stringNode],
        ["type", optionalNode(stringNode)],
        ["metadataSchema", idMapNode(stringNode)],
        ["startingZone", stringNode],
        ["initialMetadata", idMapNode(jsonNode)],
        ["metadataVisibility", idMapNode(stringNode)],
      ]),
    ),
  ],
  [
    "zones",
    arrayNode(
      objectNode([
        ["id", stringNode],
        ["ordered", boolNode],
        ["owner", optionalNode(stringNode)],
        ["visibility", visibilityRules],
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
        ["visibility", visibilityRules],
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
        ["ownerId", optionalNode(stringNode)],
        ["visibility", visibilityRules],
        [
          "derivedSpec",
          optionalNode(
            objectNode([
              ["kind", stringNode],
              ["zone", stringNode],
            ]),
          ),
        ],
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
        ["reducerRef", stringNode],
        ["fieldVisibility", idMapNode(stringNode)],
      ]),
    ),
  ],
  [
    "policies",
    objectNode([
      ["cascadeCap", intNode],
      ["costBudgets", idMapNode(intNode)],
    ]),
  ],
  ["hookBindings", idMapNode(strings)],
  ["gameId", stringNode],
  [
    "roles",
    arrayNode(
      objectNode([
        ["id", stringNode],
        ["subject", stringNode],
      ]),
    ),
  ],
  ["rosterReducerRef", optionalNode(stringNode)],
]);
