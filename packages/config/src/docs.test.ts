import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DEFINITION_ERROR_CODES,
  collectHookReferences,
  compileDefinition,
} from "@cge/core";
import { CONFIG_ERROR_CODES, loadServerConfig } from "./server-config.js";
import { parseYaml } from "./yaml.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..");

function doc(name: string): string {
  const path = join(REPO_ROOT, "docs", name);
  expect(existsSync(path), `${path} must exist`).toBe(true);
  return readFileSync(path, "utf8");
}

/** The first fenced block of `lang` that follows the heading line `heading`. */
function fenceAfter(text: string, heading: string, lang: string): string {
  const start = text.indexOf(`\n${heading}\n`);
  expect(start, `heading ${heading}`).toBeGreaterThanOrEqual(0);
  const open = text.indexOf("```" + lang + "\n", start);
  expect(open, `a ${lang} block after ${heading}`).toBeGreaterThan(start);
  const body = open + 4 + lang.length;
  const close = text.indexOf("\n```", body);
  expect(close).toBeGreaterThan(body);
  return text.slice(body, close + 1);
}

function expectMentions(text: string, keys: readonly string[]): void {
  const missing = keys.filter((key) => !text.includes(`\`${key}\``));
  expect(missing, "keys missing from the document").toEqual([]);
}

/** Every key of the `game.yaml` schema, as written in the schema reference. */
const GAME_YAML_TOP_LEVEL = [
  "id",
  "action_schema_version",
  "roles",
  "seats",
  "zones",
  "cards",
  "counters",
  "conservation_groups",
  "control",
  "meta_schemas",
  "roster_reducer",
  "view_keys",
  "hooks",
  "policies",
];

const GAME_YAML_NESTED = [
  "roles[].id",
  "roles[].subject",
  "seats.list",
  "seats.list[].id",
  "seats.list[].team",
  "seats.teams",
  "seats.count",
  "seats.prefix",
  "zones[].id",
  "zones[].ordering",
  "zones[].owner_id",
  "zones[].for_each",
  "zones[].visibility",
  "zones[].template",
  "zones[].owner",
  "zones[].max_instances",
  "cards[].id",
  "cards[].type",
  "cards[].zone",
  "cards[].metadata",
  "cards[].metadata_schema",
  "cards[].generate",
  "cards[].generate.axes",
  "cards[].generate.axes[].name",
  "cards[].generate.axes[].values",
  "cards[].generate.id",
  "cards[].generate.type",
  "cards[].generate.zone",
  "cards[].generate.metadata",
  "cards[].generate.metadata_schema",
  "counters[].id",
  "counters[].owner",
  "counters[].owner_id",
  "counters[].min",
  "counters[].max",
  "counters[].initial",
  "counters[].scale",
  "counters[].rounding",
  "counters[].supply_role",
  "counters[].derived",
  "counters[].visibility",
  "counters[].for_each",
  "conservation_groups[].id",
  "conservation_groups[].counters",
  "control.phases",
  "control.initial_phase",
  "control.turn_order",
  "control.initial_active_seats",
  "control.pointers",
  "control.enforce_active_seats",
  "control.out_of_turn",
  "meta_schemas[].id",
  "meta_schemas[].reducer",
  "meta_schemas[].fields",
  "hooks.module",
  "hooks.validation",
  "hooks.reaction",
  "hooks.gate_resolve",
  "hooks.authorization",
  "policies.cascade_cap",
  "policies.cost_budgets",
];

const SERVER_YAML_KEYS = [
  "server.http.host",
  "server.http.port",
  "server.ws.max_subscribers_per_session",
  "server.ws.outbound_queue",
  "auth.mode",
  "auth.keys",
  "auth.keys[].id",
  "auth.keys[].secret",
  "auth.keys[].can",
  "sessions.cache.max_loaded",
  "sessions.cache.idle_ttl",
  "sessions.mailbox_limit",
  "store.kind",
  "store.sqlite.path",
  "store.sqlite.journal",
  "games.search_paths",
  "limits.cascade_cap.default",
  "limits.cascade_cap.max",
  "limits.hook.timeout",
  "limits.hook.cost_budget",
  "logging.level",
  "logging.format",
];

describe("documentation (VC-273)", () => {
  it("has every new document at its path", () => {
    for (const name of [
      "game-definition-schema.md",
      "server-config.md",
      "game-definitions.md",
    ]) {
      expect(existsSync(join(REPO_ROOT, "docs", name)), name).toBe(true);
    }
  });

  describe("game-definition-schema.md", () => {
    const text = doc("game-definition-schema.md");

    it("mentions every top-level key and every nested key of game.yaml", () => {
      expectMentions(text, GAME_YAML_TOP_LEVEL);
      expectMentions(text, GAME_YAML_NESTED);
    });

    it("lists every DefinitionErrorCode", () => {
      expectMentions(text, DEFINITION_ERROR_CODES);
    });

    it("has a worked example that compiles", () => {
      const yaml = fenceAfter(text, "## Worked example", "yaml");
      const parsed = parseYaml(yaml);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      const exports = collectHookReferences(parsed.value);
      expect(exports.length).toBeGreaterThan(0);
      const result = compileDefinition(parsed.value, {
        bundle: { hash: "0".repeat(64), exports },
      });
      expect(result.ok ? [] : result.errors).toEqual([]);
    });
  });

  describe("server-config.md", () => {
    const text = doc("server-config.md");

    it("mentions every server.yaml key", () => {
      expectMentions(text, SERVER_YAML_KEYS);
    });

    it("lists every ConfigErrorCode", () => {
      expectMentions(text, CONFIG_ERROR_CODES);
    });

    it("has an example that loads", () => {
      const yaml = fenceAfter(text, "## Example", "yaml");
      const result = loadServerConfig(yaml, {
        ENGINE_HOST_KEY: "k".repeat(24),
      });
      expect(result.ok ? [] : result.error).toEqual([]);
    });

    it("documents the config:check exit codes", () => {
      expect(text).toContain("config:check");
      for (const code of ["0", "1", "2"]) {
        expect(text).toContain(`| \`${code}\` |`);
      }
    });
  });

  describe("game-definitions.md", () => {
    const text = doc("game-definitions.md");

    it("explains identity, the registry and the bundle build", () => {
      for (const needle of [
        "DefinitionId",
        "contentHash",
        "bundleHash",
        "buildHookBundle",
        "createFilesystemDefinitionRegistry",
        "DEFINITION_HASH_MISMATCH",
      ]) {
        expect(text.includes(needle), needle).toBe(true);
      }
    });

    it("names the later phases that own what this one does not do", () => {
      for (const phrase of [
        "visibility semantics",
        "hook execution",
        "registry service",
      ]) {
        expect(text.toLowerCase().includes(phrase), phrase).toBe(true);
      }
    });
  });

  it("dev-setup.md lists the new root scripts", () => {
    const text = doc("dev-setup.md");
    expect(text).toContain("bundle:games");
    expect(text).toContain("config:check");
  });

  it("canonical-json-profile.md names the definition identity schema", () => {
    const text = doc("canonical-json-profile.md");
    expect(text).toContain("definitionIdentitySchema");
    expect(text).toContain("bundleIdentitySchema");
    expect(text).toContain("idIdentitySchema");
  });

  it("workspace-architecture.md describes the new package contents", () => {
    const text = doc("workspace-architecture.md");
    expect(text).toContain("compileDefinition");
    expect(text).toContain("DefinitionRegistry");
    expect(text).toContain("createFilesystemDefinitionRegistry");
    expect(text).toContain("loadServerConfig");
  });

  it("troubleshooting.md covers definition and configuration failures", () => {
    const text = doc("troubleshooting.md");
    for (const needle of [
      "BUNDLE_MISSING",
      "DEFINITION_HASH_MISMATCH",
      "ENV_MISSING",
      "CONFIG_INVALID",
    ]) {
      expect(text.includes(needle), needle).toBe(true);
    }
  });

  it("README.md links every new document", () => {
    const text = readFileSync(join(REPO_ROOT, "README.md"), "utf8");
    for (const name of [
      "docs/game-definition-schema.md",
      "docs/server-config.md",
      "docs/game-definitions.md",
    ]) {
      expect(text.includes(name), name).toBe(true);
    }
  });

  it("no document names the removed function-presence flags", () => {
    for (const name of readdirSync(join(REPO_ROOT, "docs"))) {
      if (!name.endsWith(".md")) continue;
      const text = doc(name);
      expect(
        /hasReducer|hasRosterReducer|definitionDataSchema/.test(text),
        `${name} names a removed flag`,
      ).toBe(false);
    }
  });

  it("shipped documents do not point at planning artifacts", () => {
    const files = [
      ...readdirSync(join(REPO_ROOT, "docs"))
        .filter((name) => name.endsWith(".md"))
        .map((name) => join(REPO_ROOT, "docs", name)),
      join(REPO_ROOT, "README.md"),
    ];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      expect(
        /02-phase-2|plan-artifacts/.test(text),
        `${file} points at planning artifacts`,
      ).toBe(false);
    }
  });
});
