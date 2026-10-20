import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compileDefinition } from "./compile/compile.js";
import { definitionContentHash } from "./identity.js";

/**
 * VC-275 (compile + hash half), DNFR-002: the Req NFR-020 floor fixture (14 seats, 4 teams,
 * 700 generated cards, 64 zones, 40 counters). Median of 20 runs after 3 discarded warm-ups.
 *
 * Strict spec thresholds (250 ms each) are enforced in the Docker `test` target (`/.dockerenv`
 * exists) or with `CGE_PERF_STRICT=1`; elsewhere a 10x ceiling applies so a busy machine does
 * not flake. The active mode is printed in the test name (same pattern as floor-performance).
 */
const STRICT = process.env.CGE_PERF_STRICT === "1" || existsSync("/.dockerenv");
const LIMIT_MS = 250 * (STRICT ? 1 : 10);
const WARMUPS = 3;
const RUNS = 20;

const raw: unknown = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("./fixtures/floor-definition.json", import.meta.url)),
    "utf8",
  ),
);

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1
    ? (sorted[mid] ?? 0)
    : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

function measure(fn: () => void): number {
  for (let i = 0; i < WARMUPS; i++) fn();
  const samples: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const t0 = performance.now();
    fn();
    samples.push(performance.now() - t0);
  }
  return median(samples);
}

const compiled = (() => {
  const r = compileDefinition(raw);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.value;
})();

describe(`VC-275 compile + hash at the floor (${STRICT ? "strict spec thresholds" : "10x local ceiling"})`, () => {
  it("the floor fixture has the NFR-020 shape", () => {
    expect(compiled.seats).toHaveLength(14);
    expect(compiled.teams).toHaveLength(4);
    expect(compiled.cards).toHaveLength(700);
    expect(compiled.zones).toHaveLength(64);
    expect(compiled.counters).toHaveLength(40);
  });

  it(`compileDefinition median <= ${String(LIMIT_MS)} ms`, () => {
    const ms = measure(() => {
      compileDefinition(raw);
    });
    console.info(
      `VC-275 compileDefinition median of ${String(RUNS)}: ${ms.toFixed(2)} ms`,
    );
    expect(ms).toBeLessThanOrEqual(LIMIT_MS);
  });

  it(`definitionContentHash median <= ${String(LIMIT_MS)} ms`, () => {
    const ms = measure(() => {
      definitionContentHash(compiled);
    });
    console.info(
      `VC-275 definitionContentHash median of ${String(RUNS)}: ${ms.toFixed(2)} ms`,
    );
    expect(ms).toBeLessThanOrEqual(LIMIT_MS);
  });

  it("DNFR-001: compiling twice gives the same hash", () => {
    const again = compileDefinition(raw);
    if (!again.ok) throw new Error("compile failed");
    expect(definitionContentHash(again.value)).toBe(
      definitionContentHash(compiled),
    );
  });
});
