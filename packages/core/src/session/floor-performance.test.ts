import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildFloorDefinition } from "../definition/definition.testing.js";
import { stateDigest } from "../replay/canonical/index.js";
import { A } from "./actions.testing.js";
import type { Action } from "./actions.js";
import { apply } from "./apply/index.js";
import { must, startState } from "./apply/apply.testing.js";
import { structuralProblems } from "./apply/invariants.testing.js";
import { zoneId } from "./ids.js";

/**
 * VC-084 / VC-100 (KFR-102, KNFR-003, KNFR-004): the Req NFR-020 floor, 14 seats, 4 teams,
 * 700 cards and 64 zones.
 *
 * Strict spec thresholds (apply of a 20-move batch <= 50 ms, `stateDigest` <= 250 ms, median
 * of 20 runs after 3 discarded warm-ups) are enforced when the run is the Docker `test`
 * target (the file `/.dockerenv` exists) or when `CGE_PERF_STRICT=1` is set. Everywhere else
 * (a developer laptop, a busy CI box) a ceiling of 10x each threshold applies, so the test
 * still catches an order-of-magnitude regression without flaking. The active mode is
 * printed in the test name.
 */
const STRICT = process.env.CGE_PERF_STRICT === "1" || existsSync("/.dockerenv");
const SCALE = STRICT ? 1 : 10;
const APPLY_MS = 50 * SCALE;
const DIGEST_MS = 250 * SCALE;
const WARMUPS = 3;
const RUNS = 20;

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

const floor = buildFloorDefinition();
const roster = floor.seats.map((s) => ({
  seat: s.id,
  ...(s.team !== undefined ? { team: s.team } : {}),
}));
const big = startState(floor, roster);

/** 20 moves between zone-00..zone-03 (ordered: 00, 02; unordered: 01, 03). */
function twentyMoves(): Action[] {
  const four = ["zone-00", "zone-01", "zone-02", "zone-03"];
  const ordered = new Set(["zone-00", "zone-02"]);
  const sim = new Map<string, string[]>(
    four.map((z) => [z, [...(big.zones[must(zoneId(z))]?.members ?? [])]]),
  );
  const batch: Action[] = [];
  for (let j = 0; j < 20; j++) {
    const src = four[j % 4] ?? "";
    const dst = four[(j + 1) % 4] ?? "";
    const card = sim.get(src)?.shift() ?? "";
    const to = sim.get(dst) ?? [];
    batch.push(A.move(card, src, dst, ordered.has(dst) ? 0 : undefined));
    if (ordered.has(dst)) to.unshift(card);
    else to.push(card);
  }
  return batch;
}

describe(`VC-084 / VC-100 floor-size smoke (${STRICT ? "strict spec thresholds" : "10x local ceiling"})`, () => {
  const batch = twentyMoves();

  it("VC-084: create, a 20-move batch and a digest work at the floor", () => {
    expect(Object.keys(big.cards)).toHaveLength(700);
    expect(Object.keys(big.zones)).toHaveLength(64);
    expect(Object.keys(big.roster.seats)).toHaveLength(14);
    const r = must(apply(floor, big, batch));
    expect(r.committed).toHaveLength(20);
    expect(r.state.seq).toBe(1);
    expect(structuralProblems(r.state)).toEqual([]);
    expect(stateDigest(floor, r.state)).toMatch(/^[0-9a-f]{64}$/);
  });

  it(`VC-100: apply of a 20-move batch, median of ${String(RUNS)} runs, <= ${String(APPLY_MS)} ms`, () => {
    const ms = measure(() => {
      must(apply(floor, big, batch));
    });
    console.info(
      `floor apply median ${ms.toFixed(2)} ms (limit ${String(APPLY_MS)})`,
    );
    expect(ms).toBeLessThanOrEqual(APPLY_MS);
  });

  it(`VC-100: stateDigest, median of ${String(RUNS)} runs, <= ${String(DIGEST_MS)} ms`, () => {
    const ms = measure(() => {
      stateDigest(floor, big);
    });
    console.info(
      `floor digest median ${ms.toFixed(2)} ms (limit ${String(DIGEST_MS)})`,
    );
    expect(ms).toBeLessThanOrEqual(DIGEST_MS);
  });

  it("KNFR-004 / VC-015: the 4-zone 20-move batch keeps 60 zones, counters and untouched cards `===`", () => {
    const r = must(apply(floor, big, batch));
    const after = r.state;
    const zoneIds = floor.zones.map((z) => z.id);
    const same = zoneIds.filter((z) => after.zones[z] === big.zones[z]);
    expect(same).toHaveLength(60);
    for (const z of ["zone-00", "zone-01", "zone-02", "zone-03"]) {
      expect(after.zones[must(zoneId(z))]).not.toBe(big.zones[must(zoneId(z))]);
    }
    expect(after.counters).toBe(big.counters);
    const touched = Object.keys(big.cards).filter(
      (c) => after.cards[c as never] !== big.cards[c as never],
    );
    expect(touched.length).toBeGreaterThan(0);
    expect(touched.length).toBeLessThanOrEqual(20);
    expect(
      Object.keys(big.cards).length - touched.length,
    ).toBeGreaterThanOrEqual(680);
  });
});
