import { assertDefinitionStructure } from "../assert.js";
import { definitionData } from "../data.js";
import {
  CanonicalError,
  canonicalize,
} from "../../replay/canonical/canonicalize.js";
import { definitionIdentitySchema } from "../../replay/canonical/definition-schema.js";
import type { CompiledGameDefinition } from "../types.js";
import type { ErrorCollector } from "./errors.js";

/**
 * Last step of a successful compile (DFR-010, DFR-026): the complete identity
 * data must canonicalise (profile v1) and the value must pass
 * `assertDefinitionStructure`. Violations are reported, never thrown:
 * a `CanonicalError` is `INVALID_VALUE` at its path in the compiled value
 * (`cards[3].initialMetadata.x`), a structural violation `INVALID_VALUE` at
 * the root. Returns whether the value is fine.
 */
export function verifyCompiled(
  c: ErrorCollector,
  def: CompiledGameDefinition,
): boolean {
  try {
    canonicalize(definitionIdentitySchema, definitionData(def));
  } catch (error) {
    if (error instanceof CanonicalError) {
      const path = error.path.replace(/^\$\.?/, "");
      c.add("INVALID_VALUE", path, error.message);
      return false;
    }
    throw error;
  }
  const structure = assertDefinitionStructure(def);
  if (!structure.ok) {
    c.add("INVALID_VALUE", "", structure.error.detail);
    return false;
  }
  return true;
}
