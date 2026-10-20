import type { ErrorCollector } from "./errors.js";
import { has, indexPath, isPlainObject, joinPath, member } from "./strict.js";

/** One reducer or hook reference found in the raw document. */
export interface HookReference {
  readonly name: string;
  readonly path: string;
}

/** Bundle facts the compiler needs (spec §7.3). */
export interface HookBundleInfo {
  readonly hash: string;
  readonly exports: readonly string[];
}

const HOOK_SECTIONS = ["validation", "reaction", "gate_resolve"] as const;

function namesAt(value: unknown, path: string, out: HookReference[]): void {
  if (typeof value === "string") out.push({ name: value, path });
  else if (Array.isArray(value)) {
    (value as readonly unknown[]).forEach((item, i) => {
      if (typeof item === "string")
        out.push({ name: item, path: indexPath(path, i) });
    });
  }
}

/**
 * Every reducer and hook reference of a raw document, in document order
 * (`meta_schemas[].reducer`, `roster_reducer`, then `hooks.validation`,
 * `reaction`, `gate_resolve`, `authorization`). Total: reads defensively and
 * ignores anything that is not a string reference.
 */
export function extractReferences(raw: unknown): HookReference[] {
  const out: HookReference[] = [];
  if (!isPlainObject(raw)) return out;
  const schemas = member(raw, "meta_schemas");
  if (Array.isArray(schemas)) {
    (schemas as readonly unknown[]).forEach((schema, i) => {
      if (isPlainObject(schema) && has(schema, "reducer")) {
        namesAt(
          member(schema, "reducer"),
          joinPath(indexPath("meta_schemas", i), "reducer"),
          out,
        );
      }
    });
  }
  const roster = member(raw, "roster_reducer");
  if (typeof roster === "string") {
    out.push({ name: roster, path: "roster_reducer" });
  }
  const hooks = member(raw, "hooks");
  if (isPlainObject(hooks)) {
    for (const section of HOOK_SECTIONS) {
      const map = member(hooks, section);
      if (!isPlainObject(map)) continue;
      for (const key of Object.keys(map)) {
        namesAt(
          member(map, key),
          joinPath(joinPath("hooks", section), key),
          out,
        );
      }
    }
    namesAt(member(hooks, "authorization"), "hooks.authorization", out);
  }
  return out;
}

/**
 * The sorted, distinct export names referenced by `reducer`, `roster_reducer`
 * and `hooks.*` (DFR-024). Total; reused by the bundle builder.
 */
export function collectHookReferences(raw: unknown): string[] {
  return [...new Set(extractReferences(raw).map((r) => r.name))].sort();
}

/**
 * Whether a game needs a hook bundle (DFR-047): `hooks.module` is set or any
 * reducer or hook reference exists. Pure and total.
 */
export function definitionNeedsBundle(raw: unknown): boolean {
  return rawHasModule(raw) || extractReferences(raw).length > 0;
}

function rawHasModule(raw: unknown): boolean {
  if (!isPlainObject(raw)) return false;
  const hooks = member(raw, "hooks");
  return isPlainObject(hooks) && has(hooks, "module");
}

/**
 * Bundle checks (DFR-024), reported after all sections. A reference without module
 * is `MISSING_HOOK_MODULE` (once, at the first reference); without a bundle,
 * `BUNDLE_MISSING` (once); with one, each name missing from `bundle.exports`
 * is `UNKNOWN_HOOK_EXPORT` naming the export.
 */
export function checkBundle(
  c: ErrorCollector,
  raw: unknown,
  bundle: HookBundleInfo | undefined,
): void {
  const refs = extractReferences(raw);
  const first = refs[0];
  const hasModule = rawHasModule(raw);
  if (first !== undefined && !hasModule) {
    c.add(
      "MISSING_HOOK_MODULE",
      first.path,
      `"${first.name}" is referenced but hooks.module is not set`,
      first.name,
    );
  }
  if (bundle === undefined) {
    if (hasModule || first !== undefined) {
      c.add(
        "BUNDLE_MISSING",
        hasModule ? "hooks.module" : (first?.path ?? "hooks"),
        "the definition needs a hook bundle but none was supplied",
      );
    }
    return;
  }
  for (const ref of refs) {
    if (!bundle.exports.includes(ref.name)) {
      c.add(
        "UNKNOWN_HOOK_EXPORT",
        ref.path,
        `export "${ref.name}" is not in the hook bundle`,
        ref.name,
      );
    }
  }
}
