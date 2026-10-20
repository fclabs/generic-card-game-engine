import { build } from "esbuild";
import type { Message } from "esbuild";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { collectHookReferences, hookBundleHash } from "@cge/core";
import type {
  DefinitionError,
  HookBundleInfo,
  JsonValue,
  Result,
} from "@cge/core";
import { parseYaml } from "./yaml.js";

/** Bundle output paths, relative to the game directory (spec §7.3). */
export const HOOKS_BUNDLE_PATH = "dist/hooks.js";
export const HOOKS_MANIFEST_PATH = "dist/hooks.manifest.json";

const MAX_BUILD_MESSAGES = 10;

function fail(
  code: DefinitionError["code"],
  path: string,
  detail: string,
): { ok: false; error: DefinitionError[] } {
  return { ok: false, error: [{ code, path, detail }] };
}

function isRecord(value: unknown): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Same shape rule as the compiler (DFR-023): `./…`, no `..` segment, `.ts` or `.js`. */
function validModulePath(module: string): boolean {
  return (
    module.startsWith("./") &&
    !module.split("/").includes("..") &&
    (module.endsWith(".ts") || module.endsWith(".js"))
  );
}

function describeMessage(message: Message): string {
  const at = message.location
    ? ` (${message.location.file}:${String(message.location.line)}:${String(message.location.column)})`
    : "";
  return `${message.text}${at}`;
}

function buildFailure(error: unknown): DefinitionError[] {
  const messages = (error as { errors?: unknown }).errors;
  if (Array.isArray(messages) && messages.length > 0) {
    return (messages as Message[]).slice(0, MAX_BUILD_MESSAGES).map((m) => ({
      code: "BUNDLE_INVALID" as const,
      path: "hooks.module",
      detail: describeMessage(m),
    }));
  }
  const text = error instanceof Error ? error.message : String(error);
  return [{ code: "BUNDLE_INVALID", path: "hooks.module", detail: text }];
}

/**
 * DFR-044: builds `<gameDir>/dist/hooks.js` and `dist/hooks.manifest.json` from
 * the `hooks.module` named by `<gameDir>/game.yaml`. The bundle is built and
 * hashed only; nothing here runs it (DFR-045). Never throws.
 */
export async function buildHookBundle(
  gameDir: string,
): Promise<Result<HookBundleInfo, readonly DefinitionError[]>> {
  try {
    return await buildHookBundleUnsafe(resolve(gameDir));
  } catch (error) {
    return { ok: false, error: buildFailure(error) };
  }
}

async function buildHookBundleUnsafe(
  dir: string,
): Promise<Result<HookBundleInfo, readonly DefinitionError[]>> {
  let text: string;
  try {
    text = await readFile(join(dir, "game.yaml"), "utf8");
  } catch {
    return fail("GAME_YAML_MISSING", "game.yaml", "game.yaml cannot be read");
  }
  const parsed = parseYaml(text);
  if (!parsed.ok) return parsed;
  const hooks = isRecord(parsed.value) ? parsed.value["hooks"] : undefined;
  const module = isRecord(hooks) ? hooks["module"] : undefined;
  if (typeof module !== "string") {
    return fail("BUNDLE_INVALID", "hooks.module", "hooks.module is not set");
  }
  if (!validModulePath(module)) {
    return fail(
      "BUNDLE_INVALID",
      "hooks.module",
      `hooks.module "${module}" must start with ./, contain no .. segment and end with .ts or .js`,
    );
  }
  const entry = module.slice(2);
  const isFile = await stat(join(dir, entry)).then(
    (s) => s.isFile(),
    () => false,
  );
  if (!isFile) {
    return fail(
      "BUNDLE_INVALID",
      "hooks.module",
      `hooks module "${module}" does not exist`,
    );
  }

  // Built from a working directory so esbuild's `// file` comments are relative.
  // `tsconfigRaw` stops it from reading any tsconfig.json above the game.
  const result = await build({
    absWorkingDir: dir,
    entryPoints: [entry],
    outfile: HOOKS_BUNDLE_PATH,
    bundle: true,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    minify: false,
    sourcemap: false,
    legalComments: "none",
    charset: "utf8",
    metafile: true,
    write: false,
    logLevel: "silent",
    tsconfigRaw: {},
  });

  const output = result.outputFiles[0];
  const meta = Object.values(result.metafile.outputs)[0];
  if (result.outputFiles.length !== 1 || output === undefined || !meta) {
    return fail(
      "BUNDLE_INVALID",
      "hooks.module",
      "build produced no single file",
    );
  }
  const exports = [...new Set(meta.exports)].sort();
  if (exports.length === 0 && collectHookReferences(parsed.value).length > 0) {
    return fail(
      "BUNDLE_INVALID",
      "hooks.module",
      `hooks module "${module}" exports nothing but game.yaml references hooks`,
    );
  }

  const jsBytes = output.contents;
  await mkdir(join(dir, "dist"), { recursive: true });
  await writeFile(join(dir, HOOKS_BUNDLE_PATH), jsBytes);
  await writeFile(
    join(dir, HOOKS_MANIFEST_PATH),
    `${JSON.stringify({ exports })}\n`,
  );
  return {
    ok: true,
    value: { hash: hookBundleHash(jsBytes, exports), exports },
  };
}

/** One game's outcome of `bundleGames`. */
export type BundleGameOutcome =
  | { readonly game: string; readonly ok: true; readonly info: HookBundleInfo }
  | {
      readonly game: string;
      readonly ok: false;
      readonly errors: readonly DefinitionError[];
    };

/**
 * DFR-046: builds the hook bundle of every non-hidden `<root>/<game>/` directory
 * whose `game.yaml` declares `hooks.module`, in name order. A directory without
 * `game.yaml`, or without `hooks.module`, is skipped. A missing root yields no games.
 */
export async function bundleGames(
  root: string,
): Promise<readonly BundleGameOutcome[]> {
  let names: string[];
  try {
    const entries = await readdir(root, { withFileTypes: true });
    names = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
  const outcomes: BundleGameOutcome[] = [];
  for (const game of names) {
    const dir = join(root, game);
    let text: string;
    try {
      text = await readFile(join(dir, "game.yaml"), "utf8");
    } catch {
      continue;
    }
    const parsed = parseYaml(text);
    if (parsed.ok) {
      const hooks = isRecord(parsed.value) ? parsed.value["hooks"] : undefined;
      const module = isRecord(hooks) ? hooks["module"] : undefined;
      if (module === undefined) continue;
    }
    const built = await buildHookBundle(dir);
    outcomes.push(
      built.ok
        ? { game, ok: true, info: built.value }
        : { game, ok: false, errors: built.error },
    );
  }
  return outcomes;
}
