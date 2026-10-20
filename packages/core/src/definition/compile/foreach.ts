import type { ErrorCollector } from "./errors.js";
import { joinPath } from "./strict.js";

/**
 * `for_each` expansion (DFR-018). Placeholders are `{seat}` and `{team}`
 * only; instances are produced in declaration order.
 */

export type ForEachKind = "seat" | "team";
export const FOR_EACH_KINDS: readonly ForEachKind[] = ["seat", "team"];

/** Declared seat and team ids, in declaration order. */
export interface ForEachScope {
  readonly seats: readonly string[];
  readonly teams: readonly string[];
}

/** One instance: the seat and/or team bound to the placeholders. */
export interface ForEachBinding {
  readonly seat?: string;
  readonly team?: string;
}

/**
 * Replaces `{seat}`/`{team}` in `template` from `binding`. A placeholder
 * with no bound value, an unknown placeholder name or an unmatched brace is
 * `INVALID_VALUE` at `path`; returns `undefined` after reporting.
 */
export function substitutePlaceholders(
  c: ErrorCollector,
  template: string,
  binding: ForEachBinding,
  path: string,
  entity?: string,
): string | undefined {
  let out = "";
  let i = 0;
  while (i < template.length) {
    const ch = template.charAt(i);
    if (ch === "}") {
      c.add(
        "INVALID_VALUE",
        path,
        `unmatched "}" in ${JSON.stringify(template)}`,
        entity,
      );
      return undefined;
    }
    if (ch !== "{") {
      out += ch;
      i += 1;
      continue;
    }
    const close = template.indexOf("}", i + 1);
    if (close === -1) {
      c.add(
        "INVALID_VALUE",
        path,
        `unmatched "{" in ${JSON.stringify(template)}`,
        entity,
      );
      return undefined;
    }
    const name = template.slice(i + 1, close);
    if (name !== "seat" && name !== "team") {
      c.add(
        "INVALID_VALUE",
        path,
        `unknown placeholder "{${name}}" in ${JSON.stringify(template)} (only {seat} and {team})`,
        entity,
      );
      return undefined;
    }
    const value = binding[name];
    if (value === undefined) {
      c.add(
        "INVALID_VALUE",
        path,
        `placeholder "{${name}}" has no matching for_each: ${name}`,
        entity,
      );
      return undefined;
    }
    out += value;
    i = close + 1;
  }
  return out;
}

/**
 * Bindings for `for_each: kind` (one per declared seat/team, in order), or a
 * single empty binding when `kind` is `undefined`. `for_each: team` in a game
 * with no teams is `INVALID_VALUE` at `path` (the `for_each` node).
 */
export function forEachBindings(
  c: ErrorCollector,
  scope: ForEachScope,
  kind: ForEachKind | undefined,
  path: string,
): readonly ForEachBinding[] | undefined {
  if (kind === undefined) return [{}];
  if (kind === "seat") return scope.seats.map((seat) => ({ seat }));
  if (scope.teams.length === 0) {
    c.add("INVALID_VALUE", path, "for_each: team in a game with no teams");
    return undefined;
  }
  return scope.teams.map((team) => ({ team }));
}

/**
 * Instantiates the string-valued `fields` of an item once per binding
 * (`fields` maps a field name, e.g. `id`, `owner_id`, `expand`, to its
 * template). Each result maps the same names to expanded strings; errors are
 * reported at `<path>.<field>`. Returns `undefined` if anything failed.
 */
export function expandForEach(
  c: ErrorCollector,
  scope: ForEachScope,
  kind: ForEachKind | undefined,
  path: string,
  fields: Readonly<Record<string, string>>,
  entity?: string,
): readonly Readonly<Record<string, string>>[] | undefined {
  const bindings = forEachBindings(c, scope, kind, joinPath(path, "for_each"));
  if (bindings === undefined) return undefined;
  const out: Record<string, string>[] = [];
  let good = true;
  for (const binding of bindings) {
    const instance: Record<string, string> = {};
    for (const [name, template] of Object.entries(fields)) {
      const value = substitutePlaceholders(
        c,
        template,
        binding,
        joinPath(path, name),
        entity,
      );
      if (value === undefined) good = false;
      else instance[name] = value;
    }
    out.push(instance);
    // A malformed template fails identically for every binding: report once.
    if (!good) break;
  }
  return good ? out : undefined;
}
