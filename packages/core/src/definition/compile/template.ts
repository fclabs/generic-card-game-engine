import type { ErrorCollector } from "./errors.js";

/** A parsed `{axis}` template: literal text and axis references (by index). */
export type Segment = string | { readonly axis: number };

/**
 * Parses a generator template (DFR-014). `{name}` must name one of
 * `axisNames`; an unknown name, an unmatched `{` or a stray `}` is
 * `INVALID_VALUE` at `path` naming `entity`. Returns `undefined` after
 * reporting. A template without placeholders is a single literal segment.
 */
export function parseTemplate(
  c: ErrorCollector,
  template: string,
  axisNames: readonly string[],
  path: string,
  entity: string,
): readonly Segment[] | undefined {
  const out: Segment[] = [];
  let literal = "";
  let i = 0;
  const bad = (detail: string): undefined => {
    c.add("INVALID_VALUE", path, detail, entity);
    return undefined;
  };
  while (i < template.length) {
    const ch = template.charAt(i);
    if (ch === "}") {
      return bad(`unmatched "}" in ${JSON.stringify(template)}`);
    }
    if (ch !== "{") {
      literal += ch;
      i += 1;
      continue;
    }
    const close = template.indexOf("}", i + 1);
    if (close === -1) {
      return bad(`unmatched "{" in ${JSON.stringify(template)}`);
    }
    const name = template.slice(i + 1, close);
    const axis = axisNames.indexOf(name);
    if (axis === -1) {
      return bad(
        `placeholder "{${name}}" in ${JSON.stringify(template)} names no declared axis`,
      );
    }
    if (literal !== "") out.push(literal);
    literal = "";
    out.push({ axis });
    i = close + 1;
  }
  if (literal !== "" || out.length === 0) out.push(literal);
  return out;
}

/** Renders segments with the current axis values (`values[axisIndex]`). */
export function renderTemplate(
  segments: readonly Segment[],
  values: readonly (string | number)[],
): string {
  let out = "";
  for (const s of segments) {
    out += typeof s === "string" ? s : String(values[s.axis]);
  }
  return out;
}

/** The axis index when `segments` is exactly one placeholder, else `undefined`. */
export function lonePlaceholder(
  segments: readonly Segment[],
): number | undefined {
  const only = segments[0];
  return segments.length === 1 && only !== undefined && typeof only !== "string"
    ? only.axis
    : undefined;
}

/** Whether `segments` contains any placeholder. */
export const hasPlaceholder = (segments: readonly Segment[]): boolean =>
  segments.some((s) => typeof s !== "string");
