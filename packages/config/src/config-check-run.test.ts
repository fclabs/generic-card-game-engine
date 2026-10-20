import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CONFIG_CHECK_USAGE,
  DEFAULT_SERVER_CONFIG_PATH,
  runConfigCheck,
} from "./config-check.js";

/**
 * `runConfigCheck` in process: the same behaviour the child-process tests
 * assert on the built CLI, here reachable by coverage and without a build.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SAMPLE = join(HERE, "..", "..", "..", "config", "server.yaml");
const ENV = { ENGINE_HOST_KEY: "k".repeat(16) };

describe("runConfigCheck (in process)", () => {
  let tmp: string;
  let emptyGames: string;
  let server: string;
  let badGames: string;

  /** A server config whose search paths are `paths`. */
  function serverWith(name: string, paths: readonly string[]): string {
    const file = join(tmp, name);
    const text = readFileSync(SAMPLE, "utf8").replace(
      "search_paths: [/app/games]",
      `search_paths: [${paths.join(", ")}]`,
    );
    writeFileSync(file, text);
    return file;
  }

  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), "cge-config-check-run-"));
    emptyGames = join(tmp, "empty-games");
    mkdirSync(emptyGames);
    badGames = join(tmp, "bad-games");
    mkdirSync(join(badGames, "broken"), { recursive: true });
    writeFileSync(
      join(badGames, "broken", "game.yaml"),
      "id: broken\naction_schema_version: 1\nseats: { count: 2 }\nbogus_key: 1\n",
    );
    server = join(tmp, "server.yaml");
    writeFileSync(server, readFileSync(SAMPLE, "utf8"));
  });

  afterAll(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("exit 0 and `OK 0 definitions` for a valid config and an empty games directory", async () => {
    const r = await runConfigCheck(
      ["--server", server, "--games", emptyGames],
      ENV,
    );
    expect(r).toEqual({
      exitCode: 0,
      stdout: ["OK 0 definitions"],
      stderr: [],
    });
  });

  it("exit 1 with ENV_MISSING when the key is not set; the root error names the server file", async () => {
    const r = await runConfigCheck(
      ["--server", server, "--games", emptyGames],
      {},
    );
    expect(r.exitCode).toBe(1);
    expect(r.stdout).toEqual([]);
    expect(r.stderr.join("\n")).toContain("ENV_MISSING");
    expect(r.stderr.join("\n")).toContain("ENGINE_HOST_KEY");
  });

  it("exit 1 with every game error prefixed by its directory", async () => {
    const r = await runConfigCheck(
      ["--server", server, "--games", badGames],
      ENV,
    );
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toHaveLength(1);
    expect(r.stderr[0]).toContain(join(badGames, "broken"));
    expect(r.stderr[0]).toContain("SCHEMA_UNKNOWN_KEY");
  });

  it("exit 1 when the server file cannot be read", async () => {
    const r = await runConfigCheck(["--server", join(tmp, "absent.yaml")], ENV);
    expect(r.exitCode).toBe(1);
    expect(r.stderr[0]).toContain("CONFIG_MISSING");
  });

  it("exit 2 with the usage line for a bad command line", async () => {
    for (const argv of [
      ["--bogus"],
      ["--server"],
      ["--server", "a", "--server", "b"],
      ["--server", "--games"],
      ["--games"],
      ["--games", "--server", "x"],
    ]) {
      const r = await runConfigCheck(argv, ENV);
      expect(r.exitCode, argv.join(" ")).toBe(2);
      expect(r.stdout).toEqual([]);
      expect(r.stderr.at(-1)).toBe(CONFIG_CHECK_USAGE);
    }
  });

  it("uses a configured search path that exists, and skips (with a warning) one that does not", async () => {
    const missing = join(tmp, "not-there");
    const file = serverWith("two-paths.yaml", [emptyGames, missing]);
    const r = await runConfigCheck(["--server", file], ENV);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toEqual(["OK 0 definitions"]);
    expect(r.stderr).toHaveLength(1);
    expect(r.stderr[0]).toContain(`warning: ${missing}: SEARCH_PATH_MISSING`);
  });

  it("with no configured path present, falls back to ./games when it exists, else reports SEARCH_PATH_MISSING", async () => {
    const missing = join(tmp, "also-not-there");
    const file = serverWith("none-present.yaml", [missing]);
    const r = await runConfigCheck(["--server", file], ENV);
    if (existsSync(resolve("games"))) {
      expect(r.exitCode).toBe(0);
      expect(r.stderr.join("\n")).toContain("checking");
    } else {
      expect(r.exitCode).toBe(1);
      expect(r.stderr).toHaveLength(1);
      expect(r.stderr[0]).toContain(`${missing}: SEARCH_PATH_MISSING`);
    }
  });

  it("never prints the key or any configuration value", async () => {
    const r = await runConfigCheck(["--server", server, "--games", badGames], {
      ENGINE_HOST_KEY: "very-secret-value-123",
    });
    expect(JSON.stringify(r)).not.toContain("very-secret-value-123");
  });

  it("defaults to config/server.yaml relative to the working directory", () => {
    expect(DEFAULT_SERVER_CONFIG_PATH).toBe("config/server.yaml");
  });
});
