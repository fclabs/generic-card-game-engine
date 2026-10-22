import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ok } from "../errors/result.js";
import { tapeArbitrary } from "../session/generators.testing.js";
import { buildLiveSession } from "./live-session.testing.js";
import { decodePackage, encodePackage } from "./package.js";
import { rebuild } from "./replayer.js";

/** Minimum number of random sessions (VC-350 asks for at least 500). */
const RUNS = Number(process.env["CGE_REPLAY_RUNS"] ?? "600");

describe("VC-350 replay equivalence", () => {
  it(`live digest equals replay digest at every seq over ${String(RUNS)} random sessions`, () => {
    let sessions = 0;
    let transactions = 0;
    let longest = 0;
    const kinds = new Set<string>();
    fc.assert(
      fc.property(
        tapeArbitrary,
        fc.integer({ min: 1, max: 40 }),
        fc.boolean(),
        (tape, length, viaBytes) => {
          const live = buildLiveSession(tape, {
            transactions: length,
            illegalPercent: 8,
          });
          sessions += 1;
          const n = live.states.length - 1;
          transactions += n;
          longest = Math.max(longest, n);
          for (const tx of live.package.log) {
            for (const a of tx.actions) kinds.add(a.kind);
          }
          let pkg = live.package;
          if (viaBytes) {
            const decoded = decodePackage(encodePackage(pkg));
            if (!decoded.ok) throw new Error("decode failed");
            pkg = decoded.value;
          }
          const digests: (string | undefined)[] = [live.digests[0]];
          const r = rebuild(live.resolved, pkg, {
            verify: "every",
            onStep: (s) => {
              digests.push(s.digest);
              return ok(undefined);
            },
          });
          if (!r.ok) throw new Error(`${r.error.detail}`);
          expect(digests).toEqual(live.digests);
          expect(r.value.state).toEqual(live.states[n]);
          expect(r.value.seq).toBe(n);
        },
      ),
      { numRuns: RUNS, seed: 20261022 },
    );
    expect(sessions).toBeGreaterThanOrEqual(Math.min(RUNS, 500));
    expect(longest).toBeGreaterThan(10);
    for (const kind of ["move", "shuffle", "grant_view", "zone_create"]) {
      expect(kinds.has(kind), kind).toBe(true);
    }
    console.info(
      `VC-350: ${String(sessions)} sessions, ${String(transactions)} transactions, longest ${String(longest)}, kinds ${[...kinds].sort().join(",")}`,
    );
  });
});
