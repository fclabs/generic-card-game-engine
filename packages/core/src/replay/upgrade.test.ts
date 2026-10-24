import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { SUPPORTED_ACTION_SCHEMA_VERSIONS } from "../definition/compile/constants.js";
import { err, ok } from "../errors/result.js";
import type { Result } from "../errors/result.js";
import * as rootApi from "../index.js";
import type { JsonValue } from "../session/state.js";
import { stateDigest } from "./canonical/state-schema.js";
import { buildGoldenPackageSession } from "./generate-golden-package.testing.js";
import {
  ageToLegacyV1,
  bumpUpgrader,
  TEST_UPGRADER_1_TO_2,
} from "./fixtures/test-upgrader.testing.js";
import * as replayApi from "./index.js";
import type { ReplayError } from "./replay-error.js";
import { createReplayer, replayer } from "./replayer.js";
import {
  assertUpgraderChain,
  CURRENT_ACTION_SCHEMA_VERSION,
  PACKAGE_UPGRADERS,
  upgradeToCurrent,
} from "./upgrade.js";
import type { PackageUpgrader } from "./upgrade.js";

const golden = buildGoldenPackageSession();
const { resolved, definition } = golden;

const read = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(new URL(name, import.meta.url)));
const goldenBytes = read("./golden-package.json");
const legacyBytes = read("./fixtures/legacy-v1-package.json");
const parse = (bytes: Uint8Array): JsonValue =>
  JSON.parse(new TextDecoder().decode(bytes)) as JsonValue;
const goldenJson = parse(goldenBytes);
const legacyJson = parse(legacyBytes);
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function failure<T>(r: Result<T, ReplayError>): ReplayError {
  if (r.ok) throw new Error("expected a failure");
  return r.error;
}

const v2 = createReplayer({
  versions: { current: 2, supported: [1, 2] },
  upgraders: [TEST_UPGRADER_1_TO_2],
});
const goldenDigests = golden.package.digests.map((d) => d.digest);

const noop = (from: number): PackageUpgrader => ({
  from,
  to: from + 1,
  upgrade: (raw) => ok(raw),
});

describe("VC-361 upgrade through an injected chain", () => {
  it("the legacy fixture is the golden package in the old shape (and not decodable as v2)", () => {
    expect(ageToLegacyV1(goldenJson)).toEqual(legacyJson);
    expect(legacyJson).not.toEqual(goldenJson);
    expect(replayApi.decodePackage(legacyBytes).ok).toBe(false);
  });

  it("upgradeToCurrent gives the golden package with version 2, input unchanged", () => {
    const before = clone(legacyJson);
    const frozen = clone(legacyJson);
    const r = upgradeToCurrent(frozen, {
      versions: { current: 2, supported: [1, 2] },
      upgraders: [TEST_UPGRADER_1_TO_2],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toEqual({
      ...(goldenJson as object),
      actionSchemaVersion: 2,
    });
    expect(frozen).toEqual(before);
  });

  it.each([
    ["bytes", () => legacyBytes],
    ["raw json", () => ({ raw: clone(legacyJson) })],
  ])(
    "rebuild replays a v1 package as %s to the recorded digests",
    (_n, make) => {
      const input = make();
      const digests: string[] = [];
      const r = v2.rebuild(resolved, input, {
        verify: "every",
        onStep: (step) => {
          digests.push(step.digest ?? "");
          return ok(undefined);
        },
      });
      expect(r.ok).toBe(true);
      expect(digests).toEqual(goldenDigests.slice(0, digests.length));
      expect(digests).toHaveLength(golden.package.log.length);
      if (!r.ok) return;
      expect(r.value.state).toEqual(golden.states[golden.states.length - 1]);
      expect(r.value.digest).toBe(
        stateDigest(definition, golden.states[golden.states.length - 1]!),
      );
    },
  );

  it("the raw input is not mutated by rebuild", () => {
    const raw = clone(legacyJson);
    const input = { raw };
    expect(v2.rebuild(resolved, input).ok).toBe(true);
    expect(raw).toEqual(legacyJson);
  });

  it("a v1 package without the chain (default replayer / empty chain) is rejected as unsupported when current is 2", () => {
    const bare = createReplayer({
      versions: { current: 2, supported: [1, 2] },
      upgraders: [],
    });
    const e = failure(bare.rebuild(resolved, legacyBytes));
    expect(e.code).toBe("REPLAY_MISMATCH");
    expect(e.detail).toBe("unsupported action_schema_version 1");
  });

  it("a decoded current-shaped package is rebuilt as before; a tampered digest still fails", () => {
    expect(v2.rebuild(resolved, golden.package).ok).toBe(true);
    const bad = clone(legacyJson) as { digests: { digest: string }[] };
    bad.digests[3] = { ...bad.digests[3]!, digest: "0".repeat(64) };
    const e = failure(v2.rebuild(resolved, { raw: bad as JsonValue }));
    expect(e.code).toBe("REPLAY_INVALID");
  });

  it("undecodable raw input is REPLAY_INVALID at seq 0 with the package error", () => {
    const e = failure(v2.rebuild(resolved, new Uint8Array([123])));
    expect(e.code).toBe("REPLAY_INVALID");
    expect(e.seq).toBe(0);
    expect(e.detail).toContain("PACKAGE_SYNTAX");
    const e2 = failure(
      v2.rebuild(resolved, { raw: { actionSchemaVersion: 1 } }),
    );
    expect(e2.code).toBe("REPLAY_INVALID");
    const dup = new TextEncoder().encode(
      '{"actionSchemaVersion":1,"actionSchemaVersion":1}',
    );
    expect(failure(v2.rebuild(resolved, dup)).detail).toContain(
      "PACKAGE_DUPLICATE_KEY",
    );
  });
});

describe("VC-362 assertUpgraderChain", () => {
  it("accepts a valid three-step chain and applies it in order", () => {
    const chain = [noop(1), bumpUpgrader(2), bumpUpgrader(3)];
    expect(assertUpgraderChain([1, 2, 3, 4], 4, chain)).toBeNull();
    const r = upgradeToCurrent(
      { actionSchemaVersion: 1, trail: [0] },
      {
        versions: { current: 4, supported: [1, 2, 3, 4] },
        upgraders: chain,
      },
    );
    expect(r).toEqual(ok({ actionSchemaVersion: 4, trail: [0, 2, 3] }));
    const mid = upgradeToCurrent(
      { actionSchemaVersion: 3, trail: [] },
      {
        versions: { current: 4, supported: [1, 2, 3, 4] },
        upgraders: chain,
      },
    );
    expect(mid).toEqual(ok({ actionSchemaVersion: 4, trail: [3] }));
  });

  it("a trivial chain (one version, no upgraders) is valid", () => {
    expect(assertUpgraderChain([1], 1, [])).toBeNull();
    expect(assertUpgraderChain([1, 2], 2, [noop(1)])).toBeNull();
  });

  it.each([
    [
      "a gap",
      [1, 2, 3, 4],
      4,
      [noop(1), noop(3)],
      "no upgrader from version 2",
    ],
    [
      "a duplicate step",
      [1, 2, 3],
      3,
      [noop(1), noop(1), noop(2)],
      "duplicate upgrader from version 1",
    ],
    [
      "to != from + 1",
      [1, 2, 3],
      3,
      [noop(1), { from: 2, to: 4, upgrade: (r: JsonValue) => ok(r) }],
      "upgrader from version 2 must have to 3, got 4",
    ],
    [
      "a missing upgrader for a supported version",
      [1, 2, 3],
      3,
      [noop(1)],
      "no upgrader from version 2",
    ],
    ["no upgraders at all", [1, 2], 2, [], "no upgrader from version 1"],
    [
      "a chain that does not start at the lowest version",
      [1, 2, 3],
      3,
      [noop(2)],
      "no upgrader from version 1",
    ],
    [
      "an upgrader at or above current",
      [1, 2],
      2,
      [noop(1), noop(2)],
      "upgrader from version 2 is not below current version 2",
    ],
    [
      "out-of-order steps",
      [1, 2, 3],
      3,
      [noop(2), noop(1)],
      "no upgrader from version 1",
    ],
    [
      "current not supported",
      [1],
      2,
      [],
      "current version 2 is not a supported version",
    ],
    [
      "a supported version above current",
      [1, 2],
      1,
      [],
      "supported version 2 is above current version 1",
    ],
    ["empty supported", [], 1, [], "no supported action_schema_version"],
  ] as [string, number[], number, PackageUpgrader[], string][])(
    "%s -> first violation names the version",
    (_n, supported, current, chain, message) => {
      expect(assertUpgraderChain(supported, current, chain)).toBe(message);
    },
  );
});

describe("VC-363 unsupported versions and upgrader failures", () => {
  const withVersion = (n: number): { raw: JsonValue } => ({
    raw: { ...(goldenJson as object), actionSchemaVersion: n },
  });
  const bytesWithVersion = (n: number): Uint8Array =>
    new TextEncoder().encode(
      new TextDecoder()
        .decode(goldenBytes)
        .replace(
          '"actionSchemaVersion":1',
          `"actionSchemaVersion":${String(n)}`,
        ),
    );

  it.each([0, 99, -1])(
    "version %i is unsupported by the default replayer",
    (n) => {
      for (const input of [withVersion(n), bytesWithVersion(n)]) {
        const e = failure(replayer.rebuild(resolved, input));
        expect(e.code).toBe("REPLAY_MISMATCH");
        expect(e.detail).toBe(`unsupported action_schema_version ${String(n)}`);
        expect(e.seq).toBe(0);
      }
    },
  );

  it("version 2 with supported [1] is unsupported (decoded and raw)", () => {
    const only1 = createReplayer({
      versions: { current: 1, supported: [1] },
      upgraders: [],
    });
    const e = failure(only1.rebuild(resolved, withVersion(2)));
    expect(e.code).toBe("REPLAY_MISMATCH");
    expect(e.detail).toBe("unsupported action_schema_version 2");
    const decoded = { ...golden.package, actionSchemaVersion: 2 };
    const d = failure(only1.rebuild(resolved, decoded));
    expect(d.code).toBe("REPLAY_MISMATCH");
    expect(d.detail).toContain("unsupported action_schema_version 2");
  });

  it("a supported version with no upgrader on the path is unsupported", () => {
    const gappy = createReplayer({
      versions: { current: 3, supported: [1, 2, 3] },
      upgraders: [noop(2)],
    });
    const e = failure(gappy.rebuild(resolved, withVersion(1)));
    expect(e.code).toBe("REPLAY_MISMATCH");
    expect(e.detail).toBe("unsupported action_schema_version 1");
  });

  it("an upgrader that returns an error is REPLAY_INVALID at seq 0 with its message", () => {
    const failing: PackageUpgrader = {
      from: 1,
      to: 2,
      upgrade: () => err("cannot upgrade: field x is gone"),
    };
    const r = createReplayer({
      versions: { current: 2, supported: [1, 2] },
      upgraders: [failing],
    });
    const e = failure(r.rebuild(resolved, legacyBytes));
    expect(e.code).toBe("REPLAY_INVALID");
    expect(e.seq).toBe(0);
    expect(e.detail).toBe("cannot upgrade: field x is gone");
  });

  it("an upgrader that throws or returns a non-object is REPLAY_INVALID at seq 0", () => {
    const run = (upgrade: PackageUpgrader["upgrade"]) =>
      failure(
        createReplayer({
          versions: { current: 2, supported: [1, 2] },
          upgraders: [{ from: 1, to: 2, upgrade }],
        }).rebuild(resolved, legacyBytes),
      );
    const thrown = run(() => {
      throw new Error("boom");
    });
    expect(thrown.code).toBe("REPLAY_INVALID");
    expect(thrown.detail).toContain("boom");
    const wrong = run(() => ok([1]));
    expect(wrong.code).toBe("REPLAY_INVALID");
    expect(wrong.seq).toBe(0);
  });

  it("an upgrader that mutates its argument cannot change the caller's value", () => {
    const evil: PackageUpgrader = {
      from: 1,
      to: 2,
      upgrade: (raw) => {
        (raw as { log: unknown[] }).log.length = 0;
        return ok(raw);
      },
    };
    const input = clone(legacyJson);
    const r = upgradeToCurrent(input, {
      versions: { current: 2, supported: [1, 2] },
      upgraders: [evil],
    });
    expect(r.ok).toBe(true);
    expect(input).toEqual(legacyJson);
  });

  it("raw without an integer version is left for the decoder to reject", () => {
    expect(upgradeToCurrent({ a: 1 })).toEqual(ok({ a: 1 }));
    expect(upgradeToCurrent([1])).toEqual(ok([1]));
    expect(upgradeToCurrent({ actionSchemaVersion: "1" })).toEqual(
      ok({ actionSchemaVersion: "1" }),
    );
  });
});

describe("VC-364 version policy for the real constants (PBR-005)", () => {
  const goldenFiles: Record<number, string> = { 1: "./golden-package.json" };

  it("current is the maximum supported version, 1 at this phase", () => {
    expect(CURRENT_ACTION_SCHEMA_VERSION).toBe(
      Math.max(...SUPPORTED_ACTION_SCHEMA_VERSIONS),
    );
    expect(CURRENT_ACTION_SCHEMA_VERSION).toBe(1);
  });

  it("PACKAGE_UPGRADERS satisfies assertUpgraderChain (fails when a version is added without an upgrader)", () => {
    expect(
      assertUpgraderChain(
        SUPPORTED_ACTION_SCHEMA_VERSIONS,
        CURRENT_ACTION_SCHEMA_VERSION,
        PACKAGE_UPGRADERS,
      ),
    ).toBeNull();
  });

  it("a committed golden package exists for every supported version and replays to its digests", () => {
    for (const version of SUPPORTED_ACTION_SCHEMA_VERSIONS) {
      const file = goldenFiles[version];
      expect(
        file,
        `golden package for version ${String(version)}`,
      ).toBeDefined();
      const bytes = read(file ?? "");
      const raw = parse(bytes) as { actionSchemaVersion: number };
      expect(raw.actionSchemaVersion).toBe(version);
      const r = replayer.rebuild(resolved, bytes, { verify: "every" });
      expect(r.ok, `version ${String(version)}`).toBe(true);
    }
  });

  it("a version-1 package replays unchanged through the default replayer (decoded, bytes, raw)", () => {
    const viaDecoded = replayer.rebuild(resolved, golden.package);
    const viaBytes = replayer.rebuild(resolved, goldenBytes);
    const viaRaw = replayer.rebuild(resolved, { raw: clone(goldenJson) });
    for (const r of [viaDecoded, viaBytes, viaRaw]) expect(r.ok).toBe(true);
    expect(viaBytes).toEqual(viaDecoded);
    expect(viaRaw).toEqual(viaDecoded);
    expect(upgradeToCurrent(goldenJson)).toEqual(ok(goldenJson));
  });

  it("exports the policy through replay/ and the root", () => {
    for (const name of [
      "CURRENT_ACTION_SCHEMA_VERSION",
      "PACKAGE_UPGRADERS",
      "assertUpgraderChain",
      "upgradeToCurrent",
    ] as const) {
      expect(replayApi[name], name).toBeDefined();
      expect(rootApi[name], name).toBe(replayApi[name]);
    }
  });
});
