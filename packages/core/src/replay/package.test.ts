import { describe, expect, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { PRIMITIVE_KINDS } from "../session/actions.js";
import type { Receipt, StoredSession } from "../ports/types.js";
import type { Seq } from "../session/ids.js";
import { stateDigest } from "./canonical/index.js";
import {
  buildGoldenPackageBytes,
  buildGoldenPackageSession,
  GOLDEN_PACKAGE_SESSION_ID,
} from "./generate-golden-package.testing.js";
import {
  buildPackage,
  decodePackage,
  DEFAULT_MAX_PACKAGE_BYTES,
  encodePackage,
} from "./package.js";
import type { PackageReceipt, ReplayPackage } from "./package.js";

const FILE = new URL("./golden-package.json", import.meta.url);

if (process.env["UPDATE_GOLDEN"] === "1") {
  writeFileSync(FILE, buildGoldenPackageBytes());
}
const outPath = process.env["GOLDEN_PACKAGE_OUT"];
if (outPath !== undefined) writeFileSync(outPath, buildGoldenPackageBytes());

const committed = new Uint8Array(readFileSync(FILE));
const text = new TextDecoder().decode(committed);
const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const fixture = buildGoldenPackageSession();

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

/** Parses the committed package, lets `edit` change it, and re-serialises it as plain JSON. */
function edited(edit: (pkg: Record<string, Json>) => void): Uint8Array {
  const pkg = JSON.parse(text) as Record<string, Json>;
  edit(pkg);
  return enc(JSON.stringify(pkg));
}

function codesOf(bytes: Uint8Array, opts?: { maxBytes?: number }) {
  const r = decodePackage(bytes, opts);
  if (r.ok) throw new Error("expected a failure");
  return r.error;
}

function same(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

describe("VC-345 golden package", () => {
  it("encodePackage bytes equal the committed golden-package.json byte for byte", () => {
    expect(same(buildGoldenPackageBytes(), committed)).toBe(true);
    expect(same(encodePackage(fixture.package), committed)).toBe(true);
  });

  it("is one canonical line with no wall-clock value and no trailing newline", () => {
    expect(text.includes("\n")).toBe(false);
    expect(
      text.startsWith('{"formatVersion":1,"sessionId":"golden-pkg-1",'),
    ).toBe(true);
    expect(text.endsWith("}")).toBe(true);
  });

  it("the fixture session has 12 transactions covering every primitive kind", () => {
    const pkg = fixture.package;
    expect(pkg.log).toHaveLength(12);
    expect(pkg.log.map((t) => t.seq)).toEqual(
      Array.from({ length: 12 }, (_, i) => i + 1),
    );
    const kinds = new Set(pkg.log.flatMap((t) => t.actions.map((a) => a.kind)));
    for (const kind of PRIMITIVE_KINDS)
      expect(kinds.has(kind), kind).toBe(true);
    const schemas = new Set(
      pkg.log.flatMap((t) =>
        t.actions.flatMap((a) => (a.kind === "meta" ? [a.schema_id] : [])),
      ),
    );
    for (const id of [
      "engine.gate_open",
      "engine.gate_submit",
      "engine.gate_resolve",
      "engine.grant_expire",
    ]) {
      expect(schemas.has(id), id).toBe(true);
    }
    expect(pkg.digests).toHaveLength(12);
    expect(pkg.params).toEqual({ seed: "golden-seed-1", game: "property" });
    expect(pkg.initial.id).toBe(GOLDEN_PACKAGE_SESSION_ID);
    expect(fixture.states[12]?.lifecycle).toBe("completed");
  });

  it("digests are the stateDigest of the folded states", () => {
    fixture.package.digests.forEach((d, i) => {
      const state = fixture.states[i + 1];
      if (state === undefined) throw new Error("state");
      expect(d.seq).toBe(i + 1);
      expect(d.digest).toBe(stateDigest(fixture.definition, state));
    });
  });
});

describe("VC-346 decode / encode round trip", () => {
  it("decodePackage(encodePackage(p)) deep-equals p, with bigint counters and actions", () => {
    const decoded = decodePackage(encodePackage(fixture.package));
    if (!decoded.ok) throw new Error(JSON.stringify(decoded.error));
    expect(decoded.value).toEqual(fixture.package);
    expect(typeof Object.values(decoded.value.initial.counters)[0]).toBe(
      "bigint",
    );
    const adjust = decoded.value.log
      .flatMap((t) => t.actions)
      .find((a) => a.kind === "counter_adjust");
    expect(adjust !== undefined && typeof adjust.delta === "bigint").toBe(true);
  });

  it("encodePackage(decodePackage(bytes)) equals canonical bytes", () => {
    const decoded = decodePackage(committed);
    if (!decoded.ok) throw new Error(JSON.stringify(decoded.error));
    expect(same(encodePackage(decoded.value), committed)).toBe(true);
  });

  it("a reformatted package (whitespace, shuffled keys, shuffled idMap pairs) decodes to the same value and re-encodes canonically", () => {
    const scramble = (v: Json, depth: number): Json => {
      if (Array.isArray(v)) return v.map((x) => scramble(x, depth + 1));
      if (v !== null && typeof v === "object") {
        const keys = Object.keys(v).reverse();
        const out: { [k: string]: Json } = {};
        for (const k of keys) out[k] = scramble(v[k] as Json, depth + 1);
        return out;
      }
      return v;
    };
    const pkg = scramble(JSON.parse(text) as Json, 0);
    // idMaps are arrays of [key, value] pairs: reverse every pair list in the initial state
    const state = (pkg as { initial: { [k: string]: Json } }).initial;
    for (const name of ["cards", "zones", "zoneOrdinals", "counters", "meta"]) {
      const pairs = state[name];
      if (Array.isArray(pairs)) pairs.reverse();
    }
    const pretty = enc(JSON.stringify(pkg, null, 3));
    expect(same(pretty, committed)).toBe(false);
    const decoded = decodePackage(pretty);
    if (!decoded.ok) throw new Error(JSON.stringify(decoded.error));
    expect(decoded.value).toEqual(fixture.package);
    expect(same(encodePackage(decoded.value), committed)).toBe(true);
  });
});

describe("VC-347 decode rejections", () => {
  it("65 MiB input is PACKAGE_TOO_LARGE; maxBytes is honoured", () => {
    expect(DEFAULT_MAX_PACKAGE_BYTES).toBe(64 * 1024 * 1024);
    const errors = codesOf(new Uint8Array(65 * 1024 * 1024));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ code: "PACKAGE_TOO_LARGE", path: "$" });
    expect(codesOf(committed, { maxBytes: 100 })[0]?.code).toBe(
      "PACKAGE_TOO_LARGE",
    );
    expect(decodePackage(committed, { maxBytes: committed.length }).ok).toBe(
      true,
    );
  });

  it("truncated JSON is PACKAGE_SYNTAX", () => {
    const errors = codesOf(committed.slice(0, 700));
    expect(errors).toHaveLength(1);
    expect(errors[0]?.code).toBe("PACKAGE_SYNTAX");
    expect(errors[0]?.path.startsWith("$")).toBe(true);
    expect(codesOf(new Uint8Array(0))[0]?.code).toBe("PACKAGE_SYNTAX");
  });

  it("a duplicate key at depth is PACKAGE_DUPLICATE_KEY with its path", () => {
    const a = enc(text.replace('"gameId":"', '"gameId":"zz","gameId":"'));
    expect(codesOf(a)).toEqual([
      expect.objectContaining({
        code: "PACKAGE_DUPLICATE_KEY",
        path: "$.definition.gameId",
      }),
    ]);
    const b = enc(text.replace('"control":{', '"control":{"phase":"x",'));
    expect(codesOf(b)).toEqual([
      expect.objectContaining({
        code: "PACKAGE_DUPLICATE_KEY",
        path: "$.initial.control.phase",
      }),
    ]);
  });

  it("an unknown top-level key is PACKAGE_UNKNOWN_KEY", () => {
    const bytes = enc(
      text.replace('{"formatVersion"', '{"extra":1,"formatVersion"'),
    );
    expect(codesOf(bytes)).toEqual([
      expect.objectContaining({ code: "PACKAGE_UNKNOWN_KEY", path: "$.extra" }),
    ]);
    const nested = edited((p) => {
      (p["definition"] as { [k: string]: Json })["x"] = 1;
    });
    expect(codesOf(nested)[0]).toMatchObject({
      code: "PACKAGE_UNKNOWN_KEY",
      path: "$.definition.x",
    });
  });

  it("a missing initial and a wrong-typed eventId are PACKAGE_SCHEMA", () => {
    const bytes = edited((p) => {
      delete p["initial"];
      ((p["log"] as { [k: string]: Json }[])[0] as { [k: string]: Json })[
        "eventId"
      ] = 5;
    });
    const errors = codesOf(bytes);
    expect(errors.map((e) => [e.code, e.path])).toEqual([
      ["PACKAGE_SCHEMA", "$.initial"],
      ["PACKAGE_SCHEMA", "$.log[0].eventId"],
    ]);
  });

  it("a counter as a JSON number, 1.5 and 2^53 for seq are PACKAGE_SCHEMA", () => {
    const counter = edited((p) => {
      const pairs = (p["initial"] as { [k: string]: Json })[
        "counters"
      ] as Json[][];
      (pairs[0] as Json[])[1] = 5;
    });
    expect(codesOf(counter)[0]).toMatchObject({ code: "PACKAGE_SCHEMA" });
    expect(codesOf(counter)[0]?.path.startsWith('$.initial.counters["')).toBe(
      true,
    );
    for (const bad of [1.5, 9007199254740992]) {
      const bytes = edited((p) => {
        ((p["log"] as { [k: string]: Json }[])[0] as { [k: string]: Json })[
          "seq"
        ] = bad;
      });
      expect(codesOf(bytes)).toEqual([
        expect.objectContaining({
          code: "PACKAGE_SCHEMA",
          path: "$.log[0].seq",
        }),
      ]);
    }
  });

  it("a lone surrogate is PACKAGE_SYNTAX", () => {
    const bytes = enc(text.replace('"gameId":"', '"gameId":"\\ud800'));
    expect(codesOf(bytes)).toEqual([
      expect.objectContaining({
        code: "PACKAGE_SYNTAX",
        path: "$.definition.gameId",
      }),
    ]);
  });

  it("formatVersion 2 is PACKAGE_FORMAT_VERSION (even if the rest is unreadable)", () => {
    const bytes = edited((p) => {
      p["formatVersion"] = 2;
    });
    expect(codesOf(bytes)).toEqual([
      expect.objectContaining({
        code: "PACKAGE_FORMAT_VERSION",
        path: "$.formatVersion",
      }),
    ]);
    const unreadable = enc('{"formatVersion":2,"future":[1.5]}');
    expect(codesOf(unreadable)[0]?.code).toBe("PACKAGE_FORMAT_VERSION");
    expect(codesOf(edited((p) => (p["formatVersion"] = "1")))[0]?.code).toBe(
      "PACKAGE_SCHEMA",
    );
  });

  it("log seqs 1,2,4 / 2,3 / 1,2,2 are PACKAGE_LOG_GAP", () => {
    const withSeqs = (seqs: number[]) =>
      edited((p) => {
        const log = p["log"] as { [k: string]: Json }[];
        p["log"] = seqs.map((s, i) => ({
          ...(log[i] as { [k: string]: Json }),
          seq: s,
        }));
      });
    expect(codesOf(withSeqs([1, 2, 4]))).toEqual([
      expect.objectContaining({
        code: "PACKAGE_LOG_GAP",
        path: "$.log[2].seq",
      }),
    ]);
    expect(codesOf(withSeqs([2, 3]))[0]).toMatchObject({
      code: "PACKAGE_LOG_GAP",
      path: "$.log[0].seq",
    });
    expect(codesOf(withSeqs([1, 2, 2]))[0]).toMatchObject({
      code: "PACKAGE_LOG_GAP",
      path: "$.log[2].seq",
    });
    expect(decodePackage(withSeqs([1, 2, 3])).ok).toBe(true);
    const empty = edited((p) => {
      p["log"] = [];
      p["digests"] = [];
    });
    expect(decodePackage(empty).ok).toBe(true);
  });

  it("receipt fields the schema leaves open are checked", () => {
    const bad = edited((p) => {
      const receipts = p["receipts"] as { receipt: { [k: string]: Json } }[];
      (receipts[0] as { receipt: { [k: string]: Json } }).receipt["errorCode"] =
        "NOPE";
      (receipts[1] as { receipt: { [k: string]: Json } }).receipt["seq"] = -1;
    });
    expect(codesOf(bad).map((e) => e.path)).toEqual([
      "$.receipts[0].receipt.errorCode",
      "$.receipts[1].receipt.seq",
    ]);
  });

  it("150 independent errors are reported as 100, in document order", () => {
    const bytes = edited((p) => {
      const first = (p["log"] as { [k: string]: Json }[])[0] as {
        [k: string]: Json;
      };
      p["log"] = Array.from({ length: 150 }, (_, i) => ({
        ...first,
        seq: i + 1,
        eventId: 7,
      }));
    });
    const errors = codesOf(bytes);
    expect(errors).toHaveLength(100);
    expect(errors.every((e) => e.code === "PACKAGE_SCHEMA")).toBe(true);
    expect(errors.map((e) => e.path)).toEqual(
      Array.from({ length: 100 }, (_, i) => `$.log[${String(i)}].eventId`),
    );
  });

  it("never throws for arbitrary bytes", () => {
    for (let i = 0; i < 50; i++) {
      const junk = new Uint8Array(40 + i).map(
        (_, j) => (j * 31 + i * 17) % 256,
      );
      expect(decodePackage(junk).ok).toBe(false);
    }
  });
});

describe("VC-348 receipts and digests", () => {
  const receipt = (seq: number | null): Receipt => ({
    fingerprint: "f",
    result: null,
    errorCode: null,
    seq: seq as Seq | null,
    detail: null,
    privileged: false,
  });

  it("receipts are sorted (principal, eventId) in UTF-16 order whatever the input order", () => {
    const keys: [string, string][] = [
      ["｡", "a"],
      ["\u{1f600}", "a"],
      ["b", "z"],
      ["b", "a"],
      ["B", "a"],
      ["é", "a"],
      ["b", "\u{1f600}"],
      ["b", "｡"],
    ];
    const input: PackageReceipt[] = keys.map(([principal, eventId]) => ({
      principal,
      eventId,
      receipt: receipt(null),
    }));
    const expected = [
      ["B", "a"],
      ["b", "a"],
      ["b", "z"],
      ["b", "\u{1f600}"],
      ["b", "｡"],
      ["é", "a"],
      ["\u{1f600}", "a"],
      ["｡", "a"],
    ];
    for (const order of [
      input,
      [...input].reverse(),
      [...input.slice(3), ...input.slice(0, 3)],
    ]) {
      const built = buildPackage(fixture.stored, order, {
        resolved: fixture.resolved,
      });
      if (!built.ok) throw new Error(built.error.detail);
      expect(built.value.receipts.map((r) => [r.principal, r.eventId])).toEqual(
        expected,
      );
    }
    expect(
      fixture.package.receipts.map((r) => r.principal + "/" + r.eventId),
    ).toEqual(
      [
        ...fixture.package.receipts.map((r) => r.principal + "/" + r.eventId),
      ].sort(),
    );
  });

  it("digests none / final / every", () => {
    const build = (digests?: "none" | "final" | "every") => {
      const r = buildPackage(fixture.stored, fixture.receipts, {
        resolved: fixture.resolved,
        ...(digests === undefined ? {} : { digests }),
      });
      if (!r.ok) throw new Error(r.error.detail);
      return r.value;
    };
    expect(build().digests).toEqual([]);
    expect(build("none").digests).toEqual([]);
    const finalOnly = build("final").digests;
    expect(finalOnly).toHaveLength(1);
    expect(finalOnly[0]).toEqual({
      seq: 12,
      digest: stateDigest(
        fixture.definition,
        fixture.states[12] ?? fixture.stored.initial,
      ),
    });
    const every = build("every").digests;
    expect(every.map((d) => d.seq)).toEqual(
      Array.from({ length: 12 }, (_, i) => i + 1),
    );
    every.forEach((d, i) => {
      expect(d.digest).toBe(
        stateDigest(
          fixture.definition,
          fixture.states[i + 1] ?? fixture.stored.initial,
        ),
      );
    });
    expect(build("every").params).toEqual({});
    const empty: StoredSession = { ...fixture.stored, seq: 0 as Seq, log: [] };
    const none = buildPackage(empty, [], {
      resolved: fixture.resolved,
      digests: "every",
    });
    expect(none.ok && none.value.digests).toEqual([]);
  });

  it("rejects a stored session that does not bind or replay", () => {
    const build = (stored: StoredSession) =>
      buildPackage(stored, [], {
        resolved: fixture.resolved,
        digests: "every",
      });
    const code = (stored: StoredSession) => {
      const r = build(stored);
      return r.ok ? "ok" : r.error;
    };
    expect(code({ ...fixture.stored, definitionHash: "00" })).toMatchObject({
      code: "REPLAY_MISMATCH",
      path: "definition.contentHash",
    });
    expect(
      code({
        ...fixture.stored,
        definitionId: "sha256:x" as StoredSession["definitionId"],
      }),
    ).toMatchObject({
      code: "REPLAY_MISMATCH",
      path: "definition.id",
    });
    expect(code({ ...fixture.stored, schemaVersion: 9 })).toMatchObject({
      code: "REPLAY_MISMATCH",
    });
    expect(code({ ...fixture.stored, seq: 5 as Seq })).toMatchObject({
      code: "REPLAY_INVALID",
    });
    const gappy = fixture.stored.log.map((t, i) =>
      i === 3 ? { ...t, seq: 9 as Seq } : t,
    );
    expect(code({ ...fixture.stored, log: gappy })).toMatchObject({
      code: "REPLAY_INVALID",
      seq: 4,
    });
    const broken = fixture.stored.log.map((t, i) =>
      i === 6
        ? {
            ...t,
            actions: [
              {
                kind: "flip",
                card_id: "nope",
                orientation: "face_up",
              } as never,
            ],
          }
        : t,
    );
    expect(code({ ...fixture.stored, log: broken })).toMatchObject({
      code: "REPLAY_INVALID",
      seq: 7,
    });
    const macro = fixture.stored.log.map((t, i) =>
      i === 0
        ? {
            ...t,
            actions: [
              {
                kind: "draw",
                from_zone: "deck",
                count: 1,
                to_zone: "hold",
              } as never,
            ],
          }
        : t,
    );
    expect(code({ ...fixture.stored, log: macro })).toMatchObject({
      code: "REPLAY_INVALID",
      seq: 1,
      actionIndex: 0,
    });
    const dup = [fixture.receipts[0], fixture.receipts[0]] as PackageReceipt[];
    const r = buildPackage(fixture.stored, dup, { resolved: fixture.resolved });
    expect(r.ok).toBe(false);
  });
});

describe("package shape", () => {
  it("carries no wall-clock field and keeps PFR-033 field order", () => {
    const pkg: ReplayPackage = fixture.package;
    expect(Object.keys(JSON.parse(text) as object)).toEqual([
      "formatVersion",
      "sessionId",
      "definition",
      "actionSchemaVersion",
      "initial",
      "params",
      "log",
      "receipts",
      "digests",
    ]);
    expect(pkg.forkedFrom).toBeUndefined();
    const forked: ReplayPackage = {
      ...pkg,
      forkedFrom: { sessionId: pkg.sessionId, seq: 3 as Seq },
    };
    const decoded = decodePackage(encodePackage(forked));
    expect(decoded.ok && decoded.value.forkedFrom).toEqual(forked.forkedFrom);
    expect(
      Object.keys(
        JSON.parse(new TextDecoder().decode(encodePackage(forked))) as object,
      ).pop(),
    ).toBe("forkedFrom");
  });
});
