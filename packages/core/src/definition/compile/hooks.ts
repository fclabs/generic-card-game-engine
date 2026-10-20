import { setOwn } from "../../session/records.js";
import type { HookBindingTable } from "../types.js";
import type { ErrorCollector } from "./errors.js";
import { checkId } from "./ids.js";
import { readExportName } from "./meta.js";
import {
  has,
  indexPath,
  isPlainObject,
  joinPath,
  member,
  readArray,
  readObject,
  readString,
} from "./strict.js";

const KEYS = [
  "module",
  "validation",
  "reaction",
  "gate_resolve",
  "authorization",
] as const;

const REACTION_KEY = /^(kind|phase|trigger):[A-Za-z0-9_.:-]+$/;
const MODULE_PATH = /^\.\/[A-Za-z0-9_.@-]+(\/[A-Za-z0-9_.@-]+)*\.(ts|js)$/;

export interface CompiledHooks {
  readonly hookBindings: HookBindingTable;
  /** `hooks.module` (build input; never part of the compiled data). */
  readonly module?: string;
}

/** An export name or a non-empty list of export names, as a list. */
function readNames(
  c: ErrorCollector,
  raw: unknown,
  path: string,
): readonly string[] | undefined {
  if (!Array.isArray(raw)) {
    const one = readExportName(c, raw, path);
    return one === undefined ? undefined : [one];
  }
  const items = readArray(c, raw, path);
  if (items === undefined) return undefined;
  if (items.length === 0) {
    c.add("INVALID_VALUE", path, "a hook binding needs at least one export");
    return undefined;
  }
  const out: string[] = [];
  let good = true;
  items.forEach((item, i) => {
    const name = readExportName(c, item, indexPath(path, i));
    if (name === undefined) good = false;
    else out.push(name);
  });
  return good ? out : undefined;
}

/** Compiles `hooks` (DFR-023). `phases` undefined skips the `phase:` check. */
export function compileHooks(
  c: ErrorCollector,
  raw: unknown,
  path: string,
  phases: readonly string[] | undefined,
): CompiledHooks | undefined {
  const before = c.count;
  const obj = readObject(c, raw, path, KEYS);
  if (obj === undefined) return undefined;
  const table: Record<string, readonly string[]> = {};
  let module: string | undefined;

  if (has(obj, "module")) {
    const mp = joinPath(path, "module");
    const m = readString(c, member(obj, "module"), mp);
    if (m !== undefined) {
      if (!MODULE_PATH.test(m) || m.split("/").includes("..")) {
        c.add(
          "INVALID_VALUE",
          mp,
          `hooks.module must be a relative path starting "./", without ".." segments, ending .ts or .js, got ${JSON.stringify(m)}`,
          m,
        );
      } else module = m;
    }
  }

  const mapping = (
    section: "validation" | "reaction" | "gate_resolve",
    prefix: string,
    checkKey: (key: string, keyPath: string) => void,
  ): void => {
    if (!has(obj, section)) return;
    const sp = joinPath(path, section);
    const map = readObject(
      c,
      member(obj, section),
      sp,
      isPlainObject(member(obj, section))
        ? Object.keys(member(obj, section) as object)
        : [],
    );
    if (map === undefined) return;
    for (const key of Object.keys(map)) {
      const kp = joinPath(sp, key);
      const names = readNames(c, member(map, key), kp);
      const before2 = c.count;
      checkKey(key, kp);
      if (names !== undefined && c.count === before2) {
        setOwn(table, `${prefix}${key}`, names);
      }
    }
  };

  mapping("validation", "validation:", (key, kp) => {
    checkId(c, key, kp, "inbound kind", key);
  });
  mapping("reaction", "reaction:", (key, kp) => {
    if (!REACTION_KEY.test(key)) {
      c.add(
        "INVALID_VALUE",
        kp,
        `reaction key ${JSON.stringify(key)} must be kind:<k>, phase:<p> or trigger:<t>`,
        key,
      );
    } else if (
      key.startsWith("phase:") &&
      phases !== undefined &&
      !phases.includes(key.slice("phase:".length))
    ) {
      c.add(
        "UNKNOWN_REFERENCE",
        kp,
        `reaction key ${JSON.stringify(key)} names an undeclared phase`,
        key.slice("phase:".length),
      );
    }
  });
  mapping("gate_resolve", "gate_resolve:", (key, kp) => {
    checkId(c, key, kp, "gate schema id", key);
  });
  if (has(obj, "authorization")) {
    const names = readNames(
      c,
      member(obj, "authorization"),
      joinPath(path, "authorization"),
    );
    if (names !== undefined) setOwn(table, "authorization:default", names);
  }
  if (c.count !== before) return undefined;
  return module === undefined
    ? { hookBindings: table }
    : { hookBindings: table, module };
}
