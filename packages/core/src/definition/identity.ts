import { canonicalize } from "../replay/canonical/canonicalize.js";
import { definitionIdentitySchema } from "../replay/canonical/definition-schema.js";
import {
  arrayNode,
  objectNode,
  optionalNode,
  stringNode,
} from "../replay/canonical/schema.js";
import type { CanonicalSchema } from "../replay/canonical/schema.js";
import { sha256Hex } from "../replay/canonical/sha256.js";
import type { DefinitionId } from "../session/ids.js";
import { definitionData } from "./data.js";
import type { CompiledGameDefinition } from "./types.js";

/** DFR-042: `{js, exports}`; `js` is the SHA-256 hex of the bundle bytes. */
export const bundleIdentitySchema: CanonicalSchema = objectNode([
  ["js", stringNode],
  ["exports", arrayNode(stringNode)],
]);

/** DFR-043: `{contentHash, bundleHash?}`; `bundleHash` is absent for a game with no bundle. */
export const idIdentitySchema: CanonicalSchema = objectNode([
  ["contentHash", stringNode],
  ["bundleHash", optionalNode(stringNode)],
]);

/**
 * DFR-040: lower-case hex SHA-256 of `canonicalize(definitionIdentitySchema, definitionData(def))`.
 * Never throws for a value `compileDefinition` returned (DFR-010); a hand-built definition outside
 * canonical profile v1 throws `CanonicalError`.
 */
export function definitionContentHash(def: CompiledGameDefinition): string {
  return sha256Hex(canonicalize(definitionIdentitySchema, definitionData(def)));
}

/**
 * DFR-042: lower-case hex SHA-256 of `canonicalize(bundleIdentitySchema, {js: sha256Hex(jsBytes), exports})`.
 * `exports` is sorted (UTF-16 code-unit order) and de-duplicated first, so input order is irrelevant.
 */
export function hookBundleHash(
  jsBytes: Uint8Array,
  exports: readonly string[],
): string {
  const names = [...new Set(exports)].sort();
  return sha256Hex(
    canonicalize(bundleIdentitySchema, {
      js: sha256Hex(jsBytes),
      exports: names,
    }),
  );
}

/**
 * DFR-043: `sha256:` + hex SHA-256 of `canonicalize(idIdentitySchema, {contentHash, bundleHash?})`.
 * A definition without a bundle and one with a bundle never share an id. Distinct from the P1
 * validator `definitionId(unknown)` in `core/session`.
 */
export function computeDefinitionId(
  contentHash: string,
  bundleHash?: string,
): DefinitionId {
  const value: { contentHash: string; bundleHash?: string } = { contentHash };
  if (bundleHash !== undefined) value.bundleHash = bundleHash;
  return `sha256:${sha256Hex(canonicalize(idIdentitySchema, value))}` as DefinitionId;
}
