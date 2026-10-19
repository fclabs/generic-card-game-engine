import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const docUrl = new URL(
  "../../../docs/canonical-json-profile.md",
  import.meta.url,
);
const doc = readFileSync(docUrl, "utf8");

describe("canonical JSON profile document", () => {
  it("marks the profile frozen", () => {
    expect(doc).toMatch(/\bfrozen\b/i);
  });

  it("names the golden vectors file, which exists", () => {
    const path = "packages/core/src/replay/canonical/golden-vectors.json";
    expect(doc).toContain(path);
    const vectors = JSON.parse(
      readFileSync(
        new URL("./replay/canonical/golden-vectors.json", import.meta.url),
        "utf8",
      ),
    ) as unknown[];
    expect(vectors.length).toBeGreaterThanOrEqual(25);
  });

  it.each([1, 2, 3, 4, 5, 6, 7, 8])("states rule %i as a heading", (n) => {
    expect(doc).toMatch(new RegExp(`^#{2,4} Rule ${String(n)}\\b`, "m"));
  });

  it("lists every schema node kind", () => {
    for (const kind of [
      "int",
      "bigint",
      "string",
      "bool",
      "null",
      "optional",
      "array",
      "object",
      "idMap",
      "json",
    ]) {
      expect(doc).toContain(`\`${kind}`);
    }
  });

  it("lists the state fields in digest order", () => {
    const order = [
      "lifecycle",
      "seq",
      "cards",
      "zones",
      "zoneOrdinals",
      "counters",
      "derivedCounters",
      "meta",
      "roster",
      "control",
      "gates",
      "delegations",
      "grants",
      "outcome",
    ];
    const positions = order.map((field) => doc.indexOf(`| \`${field}\` |`));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("does not point at planning artifacts", () => {
    expect(doc).not.toMatch(/01-phase-1|plan-artifacts|iterations\//);
  });
});
