/**
 * `CanonicalSchema` (spec §6.2 rule 2): a plain, JSON-serialisable data tree describing
 * how a value is canonicalised. Field order of `object` is the emitted key order.
 */
export type CanonicalSchema =
  | { readonly kind: "int" }
  | { readonly kind: "bigint" }
  | { readonly kind: "string" }
  | { readonly kind: "bool" }
  | { readonly kind: "null" }
  | { readonly kind: "json" }
  | { readonly kind: "optional"; readonly of: CanonicalSchema }
  | { readonly kind: "array"; readonly of: CanonicalSchema }
  | { readonly kind: "idMap"; readonly of: CanonicalSchema }
  | {
      readonly kind: "object";
      readonly fields: readonly (readonly [string, CanonicalSchema])[];
    };

export const intNode: CanonicalSchema = { kind: "int" };
export const bigintNode: CanonicalSchema = { kind: "bigint" };
export const stringNode: CanonicalSchema = { kind: "string" };
export const boolNode: CanonicalSchema = { kind: "bool" };
export const nullNode: CanonicalSchema = { kind: "null" };
export const jsonNode: CanonicalSchema = { kind: "json" };

/** Object field that may be absent (omitted from the output when absent). */
export function optionalNode(of: CanonicalSchema): CanonicalSchema {
  return { kind: "optional", of };
}

/** Array whose elements all fit `of`; order is kept. */
export function arrayNode(of: CanonicalSchema): CanonicalSchema {
  return { kind: "array", of };
}

/** Record keyed by id, emitted as `[key, value]` pairs sorted by UTF-16 code-unit order of the key. */
export function idMapNode(of: CanonicalSchema): CanonicalSchema {
  return { kind: "idMap", of };
}

/** Plain object with fixed field names and emission order. */
export function objectNode(
  fields: readonly (readonly [string, CanonicalSchema])[],
): CanonicalSchema {
  return { kind: "object", fields };
}
