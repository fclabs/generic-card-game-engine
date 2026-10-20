import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadServerConfig } from "./server-config.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..");
const SAMPLE = join(REPO_ROOT, "config", "server.yaml");
const CLI = join(REPO_ROOT, "packages", "config", "dist", "cli.js");
const GOOD_KEY = "x".repeat(16);

describe("config/server.yaml (VC-264)", () => {
  const text = readFileSync(SAMPLE, "utf8");

  it("loads with ENGINE_HOST_KEY set (DFR-074)", () => {
    const result = loadServerConfig(text, { ENGINE_HOST_KEY: GOOD_KEY });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.games.searchPaths).toEqual(["/app/games"]);
      expect(result.value.store).toEqual({
        kind: "sqlite",
        sqlite: { path: "/data/engine.db", journal: "wal" },
      });
      expect(result.value.auth.keys[0]?.secret).toBe(GOOD_KEY);
    }
  });

  it("fails when ENGINE_HOST_KEY is unset (ENV_MISSING)", () => {
    const result = loadServerConfig(text, {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.map((e) => e.code)).toEqual(["ENV_MISSING"]);
      expect(result.error[0]?.detail).toContain("ENGINE_HOST_KEY");
    }
  });

  it("fails when ENGINE_HOST_KEY is empty (CONFIG_INVALID, redacted)", () => {
    const result = loadServerConfig(text, { ENGINE_HOST_KEY: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error[0]?.code).toBe("CONFIG_INVALID");
      expect(result.error[0]?.path).toBe("auth.keys[0].secret");
    }
  });

  it("has no secret line without a placeholder", () => {
    const secretLines = text
      .split("\n")
      .filter((line) => /^\s*(-\s+)?secret\s*:/.test(line));
    expect(secretLines.length).toBeGreaterThan(0);
    for (const line of secretLines) {
      expect(line).toContain("${");
    }
  });
});

describe("pnpm config:check CLI (VC-265)", () => {
  let tmp: string;
  let emptyGames: string;
  let badGames: string;

  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), "cge-config-check-"));
    emptyGames = join(tmp, "empty-games");
    mkdirSync(emptyGames);
    badGames = join(tmp, "bad-games");
    mkdirSync(join(badGames, "broken"), { recursive: true });
    writeFileSync(
      join(badGames, "broken", "game.yaml"),
      "id: broken\naction_schema_version: 1\nseats: { count: 2 }\nbogus_key: 1\n",
    );
  });

  afterAll(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  function run(
    args: readonly string[],
    env: Record<string, string>,
    cwd: string = REPO_ROOT,
  ): { status: number | null; stdout: string; stderr: string } {
    const base: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined && k !== "ENGINE_HOST_KEY") {
        base[k] = v;
      }
    }
    const r = spawnSync(process.execPath, [CLI, ...args], {
      cwd,
      env: { ...base, ...env },
      encoding: "utf8",
    });
    return { status: r.status, stdout: r.stdout, stderr: r.stderr };
  }

  it("valid env: exit 0 and `OK 0 definitions`", () => {
    const r = run(["--games", emptyGames], { ENGINE_HOST_KEY: GOOD_KEY });
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("OK 0 definitions");
    expect(r.stderr).not.toContain(GOOD_KEY);
  });

  it("ENGINE_HOST_KEY unset: exit 1, ENV_MISSING naming the variable", () => {
    const r = run(["--games", emptyGames], {});
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("ENV_MISSING");
    expect(r.stderr).toContain("ENGINE_HOST_KEY");
    expect(r.stdout).toBe("");
  });

  it("--server with an unknown key: exit 1, CONFIG_UNKNOWN_KEY", () => {
    const server = join(tmp, "unknown-key.yaml");
    writeFileSync(
      server,
      readFileSync(SAMPLE, "utf8") + "\nmystery_section: true\n",
    );
    const r = run(["--server", server, "--games", emptyGames], {
      ENGINE_HOST_KEY: GOOD_KEY,
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("mystery_section: CONFIG_UNKNOWN_KEY:");
  });

  it("search path with an invalid game: exit 1 with the game's error lines", () => {
    const r = run(["--games", badGames], { ENGINE_HOST_KEY: GOOD_KEY });
    expect(r.status).toBe(1);
    const lines = r.stderr.trim().split("\n");
    expect(lines.some((l) => l.includes("SCHEMA_UNKNOWN_KEY"))).toBe(true);
    expect(lines.every((l) => /^[^:]+: [A-Z_]+: .+/.test(l))).toBe(true);
    expect(r.stderr).toContain(join(badGames, "broken"));
  });

  it("missing --games directory: SEARCH_PATH_MISSING", () => {
    const r = run(["--games", join(tmp, "nope")], {
      ENGINE_HOST_KEY: GOOD_KEY,
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("SEARCH_PATH_MISSING");
  });

  it("default search path absent on the host: warns and checks ./games", () => {
    const cwd = join(tmp, "default-cwd");
    mkdirSync(join(cwd, "config"), { recursive: true });
    mkdirSync(join(cwd, "games"));
    cpSync(SAMPLE, join(cwd, "config", "server.yaml"));
    const r = run([], { ENGINE_HOST_KEY: GOOD_KEY }, cwd);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("OK 0 definitions");
    expect(r.stderr).toContain("SEARCH_PATH_MISSING");
  });

  it("unreadable server file: exit 1; bad flags: exit 2", () => {
    const missing = run(["--server", join(tmp, "absent.yaml")], {});
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain("CONFIG_MISSING");
    const bad = run(["--bogus"], {});
    expect(bad.status).toBe(2);
    expect(bad.stderr).toContain("usage:");
  });
});
