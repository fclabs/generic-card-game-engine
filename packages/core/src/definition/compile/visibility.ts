import type { VisibilityRules } from "../types.js";
import type { ErrorCollector } from "./errors.js";

/**
 * What a `visibility` block is attached to. Iteration 4 needs this to reject
 * `owner`/`team` audiences on unowned entities (DFR-021).
 */
export interface VisibilityTarget {
  readonly kind: "zone" | "template" | "counter";
  /** Entity id (or the id template of a `for_each` item). */
  readonly entity: string;
  /** Whether the entity has an owner (`owner`/`team` audiences make sense). */
  readonly owned: boolean;
}

/**
 * STUB (known gap until iteration 4, DFR-021): every entity section calls this
 * for a present `visibility` key, and it compiles the block to `{}` ("no
 * declaration") without reading it. Iteration 4 replaces the body (same
 * signature) with role/audience validation.
 */
export function compileVisibility(
  c: ErrorCollector,
  raw: unknown,
  path: string,
  target: VisibilityTarget,
): VisibilityRules {
  void c;
  void raw;
  void path;
  void target;
  return {};
}
