import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { parseYaml } from "./yaml.js";

function failure(text: string, opts?: Parameters<typeof parseYaml>[1]) {
  const r = parseYaml(text, opts);
  if (r.ok) throw new Error(`expected failure, got ${JSON.stringify(r.value)}`);
  return r.error;
}

function success(text: string, opts?: Parameters<typeof parseYaml>[1]) {
  const r = parseYaml(text, opts);
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.value;
}

/** `n` aliases of one anchor, as a flow sequence. */
const aliasDoc = (n: number): string =>
  `base: &b {x: 1}\nuse: [${Array.from({ length: n }, () => "*b").join(", ")}]\n`;

describe("VC-201 YAML 1.2 core schema (DFR-001)", () => {
  it("keeps yes/no as strings and numbers as numbers", () => {
    expect(success("a: yes\nb: no\nc: 1\nd: 1.5\ne: ~\nf: [x]")).toEqual({
      a: "yes",
      b: "no",
      c: 1,
      d: 1.5,
      e: null,
      f: ["x"],
    });
  });

  it("resolves anchors and aliases to equal objects", () => {
    const v = success("base: &b {x: 1}\nuse: *b") as Record<string, unknown>;
    expect(v["use"]).toEqual({ x: 1 });
    expect(v["use"]).toEqual(v["base"]);
  });

  it("returns only plain JSON data (no Date, Map, bigint)", () => {
    const v = success(
      "when: 2024-01-01\nflag: true\nbig: 12345678901234567890\nhex: 0x1F\nnested: {a: [null, false]}",
    );
    expect(v).toEqual({
      when: "2024-01-01",
      flag: true,
      big: 12345678901234567000,
      hex: 31,
      nested: { a: [null, false] },
    });
    expect(Object.getPrototypeOf(v)).toBe(Object.prototype);
  });

  it("accepts a scalar document", () => {
    expect(success("~")).toBeNull();
    expect(success("42")).toBe(42);
  });
});

describe("VC-202 size and alias limits (DFR-002)", () => {
  const exact = (bytes: number): string =>
    "# " + "x".repeat(bytes - 8) + "\na: 1\n";

  it("accepts 1 048 576 bytes and rejects 1 048 577", () => {
    const ok = exact(1_048_576);
    expect(Buffer.byteLength(ok)).toBe(1_048_576);
    expect(parseYaml(ok).ok).toBe(true);
    const big = ok + " ";
    expect(Buffer.byteLength(big)).toBe(1_048_577);
    const e = failure(big);
    expect(e).toHaveLength(1);
    expect(e[0]?.code).toBe("YAML_TOO_LARGE");
    expect(e[0]?.detail).toContain("1048576");
  });

  it("counts UTF-8 bytes, not characters", () => {
    const text = "a: " + "é".repeat(10) + "\n"; // 3 + 20 + 1 = 24 bytes, 14 characters
    expect(text.length).toBe(14);
    expect(parseYaml(text, { maxBytes: 24 }).ok).toBe(true);
    expect(failure(text, { maxBytes: 23 })[0]?.code).toBe("YAML_TOO_LARGE");
    const emoji = "a: " + "😀".repeat(3) + "\n"; // 4 bytes each
    expect(failure(emoji, { maxBytes: 3 + 12 })[0]?.code).toBe(
      "YAML_TOO_LARGE",
    );
    expect(parseYaml(emoji, { maxBytes: 3 + 12 + 1 }).ok).toBe(true);
  });

  it("accepts 100 aliases and rejects 101", () => {
    expect(parseYaml(aliasDoc(100)).ok).toBe(true);
    const e = failure(aliasDoc(101));
    expect(e[0]?.code).toBe("YAML_FORBIDDEN_FEATURE");
    expect(e[0]?.detail).toContain("100");
    expect(e[0]?.detail).toMatch(/line 2, column \d+/);
  });

  it("honours custom limits (0 disallows aliases)", () => {
    expect(parseYaml(aliasDoc(3), { maxAliases: 3 }).ok).toBe(true);
    expect(failure(aliasDoc(3), { maxAliases: 2 })[0]?.code).toBe(
      "YAML_FORBIDDEN_FEATURE",
    );
    expect(failure(aliasDoc(1), { maxAliases: 0 })[0]?.code).toBe(
      "YAML_FORBIDDEN_FEATURE",
    );
  });
});

describe("VC-203 duplicate keys (DFR-003)", () => {
  it("reports depth 1 with key, line and column", () => {
    const e = failure("a: 1\nb: 2\na: 3");
    expect(e).toHaveLength(1);
    expect(e[0]?.code).toBe("YAML_DUPLICATE_KEY");
    expect(e[0]?.detail).toContain('"a"');
    expect(e[0]?.detail).toContain("line 3, column 1");
  });

  it("reports depth 3", () => {
    const e = failure("a:\n  b:\n    c: 1\n    d: 2\n    c: 3\n");
    expect(e[0]?.code).toBe("YAML_DUPLICATE_KEY");
    expect(e[0]?.detail).toContain('"c"');
    expect(e[0]?.detail).toContain("line 5, column 5");
  });

  it("reports a duplicate inside an anchored mapping", () => {
    const e = failure("a: &m\n  k: 1\n  k: 2\nb: *m");
    expect(e[0]?.code).toBe("YAML_DUPLICATE_KEY");
    expect(e[0]?.detail).toContain('"k"');
  });

  it("reports keys that only collide after alias expansion", () => {
    const e = failure("k: &k x\n? *k\n: 1\n? *k\n: 2");
    expect(e[0]?.code).toBe("YAML_DUPLICATE_KEY");
    expect(e[0]?.detail).toContain('"x"');
    expect(e[0]?.detail).toContain("line 4");
  });
});

describe("VC-204 forbidden features (DFR-004)", () => {
  const cases: [string, string, RegExp][] = [
    ["!!str x", "tag", /explicit tag/],
    ["!custom {a: 1}", "tag", /explicit tag/],
    ["base: &b {x: 1}\n<<: *b", "merge", /merge key/],
    ["1: a", "non-string key", /keys must be strings/],
    ["true: a", "boolean key", /keys must be strings/],
    ["null: a", "null key", /keys must be strings/],
    ["? [a]\n: 1", "complex key", /keys must be strings/],
    ["__proto__: {}", "proto", /__proto__/],
    ['"__proto__": 1', "quoted proto", /__proto__/],
    ["a: {b: {__proto__: 1}}", "nested proto", /__proto__/],
    ["a: 1\n---\nb: 2", "multi-document", /multiple documents/],
    ["", "empty", /empty document/],
    ["   \n\n", "blank", /empty document/],
    ["# only a comment", "comment only", /empty document/],
    ["a: .inf", "infinity", /non-finite/],
    ["a: .nan", "nan", /non-finite/],
    ["a: !!int 1", "tag on value", /explicit tag/],
    ["%YAML 1.1\n---\na: 1", "YAML 1.1 directive", /not supported/],
  ];
  it.each(cases)("%j (%s)", (text, _name, pattern) => {
    const e = failure(text);
    expect(e.length).toBeGreaterThan(0);
    expect(e[0]?.code).toBe("YAML_FORBIDDEN_FEATURE");
    expect(e[0]?.detail).toMatch(pattern);
    expect(e[0]?.detail).toMatch(/line \d+, column \d+/);
  });

  it("names the path of the offending node", () => {
    const e = failure("zones:\n  - id: a\n    owner: !x b");
    expect(e[0]?.path).toBe("zones[0].owner");
  });

  it("reports every forbidden feature, not just the first", () => {
    const e = failure("a: !!str x\n1: y\n__proto__: z");
    expect(e.map((x) => x.code)).toEqual(
      Array(3).fill("YAML_FORBIDDEN_FEATURE"),
    );
  });
});

describe("VC-205 syntax errors and totality (DFR-005)", () => {
  it("reports an unterminated flow sequence with line and column", () => {
    const e = failure("a: [1, 2");
    expect(e[0]?.code).toBe("YAML_SYNTAX");
    expect(e[0]?.detail).toMatch(/line 1, column \d+/);
  });

  it("reports tab indentation with line and column", () => {
    const e = failure("a:\n\tb: 1");
    expect(e[0]?.code).toBe("YAML_SYNTAX");
    expect(e[0]?.detail).toContain("line 2, column 1");
  });

  it("never throws and returns ok or a non-empty error list for any string", () => {
    const fragments = [
      "a",
      ": ",
      "- ",
      "[",
      "]",
      "{",
      "}",
      "&x ",
      "*x",
      "!t ",
      "<<",
      "---",
      "\n",
      "  ",
      "\t",
      "'",
      '"',
      "#",
      "? ",
      "%YAML 1.1\n",
      "\u0000",
      "\ud800",
      "...",
      "|",
      ">",
    ];
    const yamlish = fc
      .array(fc.constantFrom(...fragments), { maxLength: 40 })
      .map((p) => p.join(""));
    fc.assert(
      fc.property(
        fc.oneof(fc.string(), fc.string({ unit: "binary" }), yamlish),
        (text) => {
          const r = parseYaml(text);
          if (r.ok) return true;
          return (
            r.error.length > 0 &&
            r.error.every(
              (x) => x.code.startsWith("YAML_") && x.detail.length > 0,
            )
          );
        },
      ),
      { numRuns: 1000 },
    );
  });

  it("survives pathological nesting by returning errors", () => {
    const r = parseYaml("[".repeat(200_000));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.length).toBeLessThanOrEqual(100);
  });

  it("does not throw on invalid options", () => {
    expect(() =>
      parseYaml("a: 1", { maxBytes: Number.NaN, maxAliases: -1 }),
    ).not.toThrow();
  });
});

describe("VC-206 alias bomb (DFR-002, DNFR-005)", () => {
  /** Nine levels of nine aliases each: 9^9 expanded nodes from about 1 KiB and 72 aliases. */
  const bomb = (): string => {
    const lines = ["l0: &l0 [x, x, x, x, x, x, x, x, x]"];
    for (let i = 1; i <= 8; i++) {
      lines.push(
        `l${String(i)}: &l${String(i)} [${Array.from({ length: 9 }, () => `*l${String(i - 1)}`).join(", ")}]`,
      );
    }
    lines.push(`last: [${Array.from({ length: 9 }, () => "*l8").join(", ")}]`);
    return lines.join("\n") + "\n";
  };

  it("is about 1 KiB and fails YAML_FORBIDDEN_FEATURE naming the expansion limit", () => {
    const text = bomb();
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(1024);
    const e = failure(text);
    expect(e[0]?.code).toBe("YAML_FORBIDDEN_FEATURE");
    expect(e[0]?.detail).toContain("alias expansion");
  });

  it("fails within 200 ms and grows RSS by at most 64 MiB", () => {
    const text = bomb();
    parseYaml(text); // warm up the parser code paths
    const rss0 = process.memoryUsage().rss;
    const t0 = performance.now();
    const r = parseYaml(text);
    const ms = performance.now() - t0;
    const grown = process.memoryUsage().rss - rss0;
    console.info(
      `VC-206 alias bomb: ${ms.toFixed(2)} ms, RSS delta ${(grown / 1048576).toFixed(2)} MiB`,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error[0]?.code).toBe("YAML_FORBIDDEN_FEATURE");
    expect(ms).toBeLessThanOrEqual(200);
    expect(grown).toBeLessThanOrEqual(64 * 1048576);
  });

  it("rejects a flat bomb with more than 100 aliases by count", () => {
    const e = failure(aliasDoc(500));
    expect(e[0]?.code).toBe("YAML_FORBIDDEN_FEATURE");
    expect(e[0]?.detail).toContain("more than 100 aliases");
  });
});
