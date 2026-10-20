import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  compileDefinition,
  computeDefinitionId,
  definitionContentHash,
  definitionNeedsBundle,
  hookBundleHash,
} from "@cge/core";
import type {
  CompiledGameDefinition,
  DefinitionError,
  DefinitionId,
  DefinitionLimits,
  DefinitionRegistry,
  DefinitionSummary,
  HookBundleInfo,
  RegistryError,
  Result,
} from "@cge/core";
import { HOOKS_BUNDLE_PATH, HOOKS_MANIFEST_PATH } from "./bundle.js";
import { parseYaml } from "./yaml.js";

/** Options of `createFilesystemDefinitionRegistry` (spec §7.4). */
export interface FilesystemRegistryOptions {
  readonly searchPaths: readonly string[];
  readonly limits: DefinitionLimits;
}

/** Successful load: the registry and one summary per game, in search-path then name order. */
export interface FilesystemRegistryLoad {
  readonly registry: DefinitionRegistry;
  readonly definitions: readonly DefinitionSummary[];
}

/** The bytes a definition was identified from; equal bytes imply an equal id. */
interface Sources {
  readonly yaml: Buffer;
  readonly js: Buffer | undefined;
  readonly manifest: Buffer | undefined;
}

interface LoadedGame {
  readonly definition: CompiledGameDefinition;
  readonly id: DefinitionId;
  readonly sources: Sources;
}

interface Entry extends LoadedGame {
  readonly dir: string;
}

type GameResult = Result<LoadedGame, readonly DefinitionError[]>;

function err(
  code: DefinitionError["code"],
  path: string,
  detail: string,
  entity?: string,
): DefinitionError {
  return entity === undefined
    ? { code, path, detail }
    : { code, path, detail, entity };
}

async function readOptional(path: string): Promise<Buffer | undefined> {
  try {
    return await readFile(path);
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `{exports}` of the manifest, or `undefined` when it is not `{"exports": [string, ...]}`. */
function manifestExports(manifest: Buffer): readonly string[] | undefined {
  try {
    const parsed: unknown = JSON.parse(manifest.toString("utf8"));
    if (!isRecord(parsed)) return undefined;
    const list = parsed["exports"];
    if (!Array.isArray(list)) return undefined;
    return list.every((x) => typeof x === "string") ? list : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Reads, parses, compiles and identifies one game directory (DFR-051). The hook
 * bundle files are read and hashed only when the YAML needs one (DFR-047) and
 * are never executed (DFR-045). Directory-relative error paths; never throws.
 */
async function loadGame(
  dir: string,
  dirName: string,
  limits: DefinitionLimits,
): Promise<GameResult> {
  const yaml = await readOptional(join(dir, "game.yaml"));
  if (yaml === undefined) {
    return {
      ok: false,
      error: [
        err("GAME_YAML_MISSING", "game.yaml", "game.yaml cannot be read"),
      ],
    };
  }
  const parsed = parseYaml(yaml.toString("utf8"));
  if (!parsed.ok) return parsed;
  const raw = parsed.value;

  const errors: DefinitionError[] = [];
  const declared = isRecord(raw) ? raw["id"] : undefined;
  if (typeof declared === "string" && declared !== dirName) {
    errors.push(
      err(
        "GAME_ID_MISMATCH",
        "id",
        `directory "${dirName}" declares id "${declared}"`,
        declared,
      ),
    );
  }

  let js: Buffer | undefined;
  let manifest: Buffer | undefined;
  let bundle: HookBundleInfo | undefined;
  if (definitionNeedsBundle(raw)) {
    js = await readOptional(join(dir, HOOKS_BUNDLE_PATH));
    manifest = await readOptional(join(dir, HOOKS_MANIFEST_PATH));
    if (js !== undefined && manifest !== undefined) {
      const exports = manifestExports(manifest);
      if (exports === undefined) {
        errors.push(
          err(
            "BUNDLE_INVALID",
            HOOKS_MANIFEST_PATH,
            `${HOOKS_MANIFEST_PATH} is not {"exports": [names]}`,
          ),
        );
      } else {
        bundle = { hash: hookBundleHash(js, exports), exports };
      }
    }
    // A missing bundle file is left to the compiler (BUNDLE_MISSING, DFR-024).
  }

  const compiled = compileDefinition(
    raw,
    bundle === undefined ? { limits } : { bundle, limits },
  );
  if (!compiled.ok) errors.push(...compiled.errors);
  if (errors.length > 0 || !compiled.ok) return { ok: false, error: errors };

  const definition = compiled.value;
  const id = computeDefinitionId(
    definitionContentHash(definition),
    bundle?.hash,
  );
  return {
    ok: true,
    value: { definition, id, sources: { yaml, js, manifest } },
  };
}

function sameBytes(a: Buffer | undefined, b: Buffer | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.equals(b);
}

function sameSources(a: Sources, b: Sources): boolean {
  return (
    sameBytes(a.yaml, b.yaml) &&
    sameBytes(a.js, b.js) &&
    sameBytes(a.manifest, b.manifest)
  );
}

function prefixed(
  dir: string,
  errors: readonly DefinitionError[],
): DefinitionError[] {
  return errors.map((e) => ({
    ...e,
    path: e.path === "" ? dir : `${dir}/${e.path}`,
  }));
}

function summarize(errors: readonly DefinitionError[]): string {
  return errors
    .slice(0, 5)
    .map(
      (e) => `${e.code} at ${e.path === "" ? "<root>" : e.path}: ${e.detail}`,
    )
    .join("; ");
}

class FilesystemRegistry implements DefinitionRegistry {
  constructor(
    private readonly entries: Map<string, Entry>,
    private readonly limits: DefinitionLimits,
  ) {}

  async resolve(
    id: DefinitionId,
  ): Promise<Result<CompiledGameDefinition, RegistryError>> {
    try {
      return await this.resolveUnsafe(id);
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        error: {
          code: "DEFINITION_INVALID",
          detail: `unexpected failure: ${text}`,
        },
      };
    }
  }

  private async resolveUnsafe(
    id: DefinitionId,
  ): Promise<Result<CompiledGameDefinition, RegistryError>> {
    const entry = this.entries.get(id);
    if (entry === undefined) {
      return {
        ok: false,
        error: {
          code: "UNKNOWN_DEFINITION",
          detail: `no definition with id ${String(id)}`,
        },
      };
    }
    const current = await readSources(entry.dir, entry.sources);
    if (current !== undefined && sameSources(current, entry.sources)) {
      return { ok: true, value: entry.definition };
    }
    const name = entry.dir.split(/[\\/]/).pop() ?? entry.dir;
    const reloaded = await loadGame(entry.dir, name, this.limits);
    if (!reloaded.ok) {
      return {
        ok: false,
        error: {
          code: "DEFINITION_INVALID",
          detail: `${entry.dir} no longer compiles: ${summarize(reloaded.error)}`,
        },
      };
    }
    if (reloaded.value.id !== id) {
      return {
        ok: false,
        error: {
          code: "DEFINITION_HASH_MISMATCH",
          detail: `${entry.dir} changed on disk: expected ${id}, actual ${reloaded.value.id}`,
        },
      };
    }
    this.entries.set(id, { ...reloaded.value, dir: entry.dir });
    return { ok: true, value: reloaded.value.definition };
  }
}

/** Re-reads the files a game was identified from (the bundle only if it had one). */
async function readSources(
  dir: string,
  previous: Sources,
): Promise<Sources | undefined> {
  const yaml = await readOptional(join(dir, "game.yaml"));
  if (yaml === undefined) return undefined;
  // The bundle files are read only when the loaded game used them (DFR-047).
  const needsBundle =
    previous.js !== undefined || previous.manifest !== undefined;
  return {
    yaml,
    js: needsBundle
      ? await readOptional(join(dir, HOOKS_BUNDLE_PATH))
      : undefined,
    manifest: needsBundle
      ? await readOptional(join(dir, HOOKS_MANIFEST_PATH))
      : undefined,
  };
}

async function listGameDirs(searchPath: string): Promise<string[] | undefined> {
  try {
    if (!(await stat(searchPath)).isDirectory()) return undefined;
    const entries = await readdir(searchPath, { withFileTypes: true });
    const names: string[] = [];
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const isDir = entry.isSymbolicLink()
        ? await stat(join(searchPath, entry.name)).then(
            (s) => s.isDirectory(),
            () => false,
          )
        : entry.isDirectory();
      if (isDir) names.push(entry.name);
    }
    return names.sort();
  } catch {
    return undefined;
  }
}

/**
 * DFR-051..053: loads every game below the search paths, fail-fast over the whole
 * set (all errors reported, each path prefixed with the game directory), and returns
 * a registry whose `resolve` answers only while the files still produce the id.
 * Never throws; never executes a bundle.
 */
export async function createFilesystemDefinitionRegistry(
  opts: FilesystemRegistryOptions,
): Promise<Result<FilesystemRegistryLoad, readonly DefinitionError[]>> {
  const errors: DefinitionError[] = [];
  const entries = new Map<string, Entry>();
  const summaries: DefinitionSummary[] = [];
  const gameDirs = new Map<string, string>();
  try {
    for (const searchPath of opts.searchPaths) {
      const names = await listGameDirs(searchPath);
      if (names === undefined) {
        errors.push(
          err(
            "SEARCH_PATH_MISSING",
            searchPath,
            "search path does not exist or is not a directory",
          ),
        );
        continue;
      }
      for (const name of names) {
        const dir = join(searchPath, name);
        const game = await loadGame(dir, name, opts.limits);
        if (!game.ok) {
          errors.push(...prefixed(dir, game.error));
          continue;
        }
        const { definition, id } = game.value;
        const first = gameDirs.get(definition.gameId);
        if (first !== undefined) {
          errors.push(
            err(
              "DUPLICATE_ID",
              `${dir}/id`,
              `game id "${definition.gameId}" is also declared in ${first}`,
              definition.gameId,
            ),
          );
          continue;
        }
        gameDirs.set(definition.gameId, dir);
        entries.set(id, { ...game.value, dir });
        summaries.push({
          definitionId: id,
          gameId: definition.gameId,
          schemaVersion: definition.schemaVersion,
        });
      }
    }
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    errors.push(err("SEARCH_PATH_MISSING", "", `unexpected failure: ${text}`));
  }
  if (errors.length > 0) return { ok: false, error: errors };
  return {
    ok: true,
    value: {
      registry: new FilesystemRegistry(entries, opts.limits),
      definitions: summaries,
    },
  };
}
