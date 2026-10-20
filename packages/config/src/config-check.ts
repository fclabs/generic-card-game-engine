import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { createFilesystemDefinitionRegistry } from "./registry.js";
import {
  definitionLimitsFromConfig,
  loadServerConfig,
  type ServerConfig,
} from "./server-config.js";

/** Default server config path, relative to the working directory (DFR-075). */
export const DEFAULT_SERVER_CONFIG_PATH = "config/server.yaml";
/** Directory checked instead when no configured search path exists on this host. */
export const FALLBACK_GAMES_DIR = "games";

export const CONFIG_CHECK_USAGE =
  "usage: config:check [--server <path>] [--games <dir>...]";

export interface ConfigCheckResult {
  /** 0 = ok, 1 = validation errors, 2 = bad command line. */
  readonly exitCode: 0 | 1 | 2;
  readonly stdout: readonly string[];
  readonly stderr: readonly string[];
}

interface ParsedArgs {
  readonly server: string;
  readonly games: readonly string[];
}

function parseArgs(argv: readonly string[]): ParsedArgs | string {
  let server: string | undefined;
  const games: string[] = [];
  let i = 0;
  while (i < argv.length) {
    const flag = argv[i];
    if (flag === "--server") {
      const value = argv[i + 1];
      if (
        value === undefined ||
        value.startsWith("--") ||
        server !== undefined
      ) {
        return "--server needs exactly one path";
      }
      server = value;
      i += 2;
    } else if (flag === "--games") {
      i += 1;
      let count = 0;
      while (i < argv.length && !(argv[i] ?? "").startsWith("--")) {
        games.push(argv[i] ?? "");
        count += 1;
        i += 1;
      }
      if (count === 0) {
        return "--games needs at least one directory";
      }
    } else {
      return `unknown argument ${JSON.stringify(flag)}`;
    }
  }
  return { server: server ?? DEFAULT_SERVER_CONFIG_PATH, games };
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/** Search paths to scan when `--games` is absent; see DECISIONS D-036. */
async function defaultSearchPaths(
  config: ServerConfig,
  warnings: string[],
): Promise<readonly string[]> {
  const configured = config.games.searchPaths;
  const present: string[] = [];
  for (const path of configured) {
    if (await isDirectory(path)) {
      present.push(path);
    } else {
      warnings.push(
        `warning: ${path}: SEARCH_PATH_MISSING: configured search path does not exist on this host; skipped (pass --games to check another directory)`,
      );
    }
  }
  if (present.length > 0) {
    return present;
  }
  const fallback = resolve(FALLBACK_GAMES_DIR);
  if (await isDirectory(fallback)) {
    warnings.push(
      `warning: no configured search path exists on this host; checking ${fallback} instead`,
    );
    return [fallback];
  }
  // Nothing to fall back to: let the registry report the missing paths.
  warnings.length = 0;
  return configured;
}

/**
 * `config:check` (DFR-075). Pure with respect to the process: `env` is passed
 * in, output is returned. Never prints a configuration value or secret.
 */
export async function runConfigCheck(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): Promise<ConfigCheckResult> {
  const args = parseArgs(argv);
  if (typeof args === "string") {
    return {
      exitCode: 2,
      stdout: [],
      stderr: [`config:check: ${args}`, CONFIG_CHECK_USAGE],
    };
  }

  let text: string;
  try {
    text = await readFile(args.server, "utf8");
  } catch {
    return {
      exitCode: 1,
      stdout: [],
      stderr: [
        `${args.server}: CONFIG_MISSING: cannot read the server config file`,
      ],
    };
  }

  const loaded = loadServerConfig(text, env);
  if (!loaded.ok) {
    return {
      exitCode: 1,
      stdout: [],
      stderr: loaded.error.map(
        (e) =>
          `${e.path === "" ? args.server : e.path}: ${e.code}: ${e.detail}`,
      ),
    };
  }
  const config = loaded.value;

  const warnings: string[] = [];
  const searchPaths =
    args.games.length > 0
      ? args.games.map((g) => resolve(g))
      : await defaultSearchPaths(config, warnings);

  const registry = await createFilesystemDefinitionRegistry({
    searchPaths,
    limits: definitionLimitsFromConfig(config),
  });
  if (!registry.ok) {
    return {
      exitCode: 1,
      stdout: [],
      stderr: [
        ...warnings,
        ...registry.error.map(
          (e) =>
            `${e.path === "" ? args.server : e.path}: ${e.code}: ${e.detail}`,
        ),
      ],
    };
  }
  return {
    exitCode: 0,
    stdout: [`OK ${String(registry.value.definitions.length)} definitions`],
    stderr: warnings,
  };
}
