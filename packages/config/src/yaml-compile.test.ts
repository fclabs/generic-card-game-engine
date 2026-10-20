import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compileDefinition, definitionContentHash } from "@cge/core";
import type { CompiledGameDefinition } from "@cge/core";
import { parseYaml } from "./yaml.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "..", "fixtures");
const coreExpected = join(
  here,
  "..",
  "..",
  "core",
  "src",
  "definition",
  "identity-expected.json",
);

const fixture = (name: string): string =>
  readFileSync(join(fixtures, name), "utf8");

/** parseYaml then compileDefinition; throws with the errors on any failure. */
function compileText(text: string): CompiledGameDefinition {
  const parsed = parseYaml(text);
  if (!parsed.ok) throw new Error(`parse: ${JSON.stringify(parsed.error)}`);
  const compiled = compileDefinition(parsed.value);
  if (!compiled.ok)
    throw new Error(`compile: ${JSON.stringify(compiled.errors)}`);
  return compiled.value;
}

const hashText = (text: string): string =>
  definitionContentHash(compileText(text));

describe("VC-230 equivalent YAML texts have equal contentHash (DFR-041, DNFR-001)", () => {
  const base = fixture("equivalence/base.yaml");
  const variant = fixture("equivalence/variant.yaml");

  it("fixtures differ in text but not in parsed anchors-resolved content order", () => {
    expect(variant).not.toBe(base);
    expect(variant).toContain("&fields");
    expect(variant).toContain("*fields");
    expect(variant).toContain("#");
    expect(variant).toContain("enforce_active_seats: false");
  });

  it("anchors, key order, comments, whitespace and explicit defaults give the same hash", () => {
    const h = hashText(base);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hashText(variant)).toBe(h);
  });

  it("compiling twice gives the same hash", () => {
    expect(hashText(base)).toBe(hashText(base));
  });

  it("a semantic change gives another hash", () => {
    expect(hashText(base.replace("count: 4", "count: 5"))).not.toBe(
      hashText(base),
    );
    expect(
      hashText(
        variant.replace(
          "enforce_active_seats: false",
          "enforce_active_seats: true",
        ),
      ),
    ).not.toBe(hashText(base));
  });

  it("hashes the same in a child process on a .yaml file", () => {
    const script = `
      import { readFileSync } from "node:fs";
      import { parseYaml } from ${JSON.stringify(join(here, "..", "dist", "index.js"))};
      import { compileDefinition, definitionContentHash } from "@cge/core";
      const parsed = parseYaml(readFileSync(process.argv[1], "utf8"));
      if (!parsed.ok) throw new Error(JSON.stringify(parsed.error));
      const compiled = compileDefinition(parsed.value);
      if (!compiled.ok) throw new Error(JSON.stringify(compiled.errors));
      process.stdout.write(definitionContentHash(compiled.value));
    `;
    const run = (file: string): string =>
      execFileSync(
        process.execPath,
        ["--input-type=module", "-e", script, join(fixtures, file)],
        {
          cwd: join(here, ".."),
          encoding: "utf8",
        },
      );
    const inProcess = hashText(base);
    expect(run("equivalence/base.yaml")).toBe(inProcess);
    expect(run("equivalence/variant.yaml")).toBe(inProcess);
  });

  it("the YAML twin of the floor fixture hashes to the committed `floor` value", () => {
    const expected = JSON.parse(readFileSync(coreExpected, "utf8")) as {
      contentHashes: { floor: string };
    };
    expect(hashText(fixture("floor-definition.yaml"))).toBe(
      expected.contentHashes.floor,
    );
  });
});

describe("VC-275 parse parts (DNFR-003)", () => {
  const strict = process.env["CGE_PERF_STRICT"] === "1" || existsDockerenv();
  const factor = strict ? 1 : 10;

  /** A document of exactly `bytes` bytes: explicit cards with a json note, padded by a comment. */
  function megabyteDefinition(bytes: number): string {
    const head =
      "id: big\naction_schema_version: 1\nseats: {count: 2}\nzones: [{id: stock, ordering: ordered}]\ncards:\n";
    const note = "n".repeat(60);
    const cards: string[] = [];
    let size = Buffer.byteLength(head);
    for (let i = 0; ; i++) {
      const id = `c${String(i).padStart(5, "0")}`;
      const card = `  - {id: ${id}, zone: stock, metadata: {note: "${note}"}, metadata_schema: {note: {type: json, visibility: public}}}\n`;
      if (cards.length >= 10_000 || size + Buffer.byteLength(card) > bytes - 3)
        break;
      cards.push(card);
      size += Buffer.byteLength(card);
    }
    const pad = bytes - size;
    return head + cards.join("") + "#".repeat(pad - 1) + "\n";
  }

  it("parse + compile of a 1 MiB document of explicit cards takes at most 2 s", () => {
    const text = megabyteDefinition(1_048_576);
    expect(Buffer.byteLength(text)).toBe(1_048_576);
    compileText(text); // warm-up
    const times: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      const def = compileText(text);
      times.push(performance.now() - t0);
      expect(def.cards.length).toBeGreaterThan(5000);
    }
    times.sort((a, b) => a - b);
    const median = times[2] ?? Infinity;
    console.info(
      `VC-275 1 MiB parse+compile: median ${median.toFixed(1)} ms (cards: ${String(compileText(text).cards.length)}; bound ${String(2000 * factor)} ms)`,
    );
    expect(median).toBeLessThanOrEqual(2000 * factor);
  });

  it("1 MiB + 1 byte fails YAML_TOO_LARGE within 50 ms", () => {
    const text = megabyteDefinition(1_048_576) + " ";
    expect(Buffer.byteLength(text)).toBe(1_048_577);
    parseYaml(text); // warm-up
    const times: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      const r = parseYaml(text);
      times.push(performance.now() - t0);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error[0]?.code).toBe("YAML_TOO_LARGE");
    }
    times.sort((a, b) => a - b);
    const median = times[2] ?? Infinity;
    console.info(
      `VC-275 1 MiB + 1 byte rejection: median ${median.toFixed(3)} ms (bound ${String(50 * factor)} ms)`,
    );
    expect(median).toBeLessThanOrEqual(50 * factor);
  });
});

function existsDockerenv(): boolean {
  try {
    readFileSync("/.dockerenv");
    return true;
  } catch {
    return false;
  }
}
