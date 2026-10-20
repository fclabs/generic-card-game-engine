import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { buildDefinition } from "../../definition/definition.testing.js";
import { A } from "../actions.testing.js";
import { apply } from "./index.js";
import { must, startState } from "./apply.testing.js";

const boom = () => {
  throw new Error("the PRNG must not be touched by apply");
};
vi.mock("../prng.js", () => ({
  createPrng: boom,
  uniform: boom,
  shufflePermutation: boom,
  seedWords: boom,
}));

describe("VC-072 shuffle never consults the PRNG (KFR-082)", () => {
  it("applies the logged permutation while the PRNG module throws", async () => {
    const prng = await import("../prng.js");
    expect(() => prng.shufflePermutation(undefined as never, [])).toThrow();
    const def = buildDefinition();
    const r = must(
      apply(def, startState(def), [
        A.shuffle("deck", ["c3", "c1", "c6", "c2", "c5", "c4"]),
        A.move("c3", "deck", "table"),
      ]),
    );
    expect(r.state.zones["deck" as never]?.members).toEqual([
      "c1",
      "c6",
      "c2",
      "c5",
      "c4",
    ]);
    expect(r.committed[0]).toEqual(
      A.shuffle("deck", ["c3", "c1", "c6", "c2", "c5", "c4"]),
    );
  });

  it("no source under session/apply imports the PRNG module", () => {
    const dir = new URL("./", import.meta.url).pathname;
    const walk = (d: string): string[] =>
      readdirSync(d).flatMap((name) => {
        const p = join(d, name);
        return statSync(p).isDirectory() ? walk(p) : [p];
      });
    const sources = walk(dir).filter(
      (f) =>
        f.endsWith(".ts") &&
        !f.endsWith(".test.ts") &&
        !f.endsWith(".testing.ts"),
    );
    expect(sources.length).toBeGreaterThan(8);
    for (const file of sources) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(
        /(?:from|import)\s*\(?\s*["'][^"']*prng/,
      );
    }
  });
});
