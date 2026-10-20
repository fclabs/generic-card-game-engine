import { describe, it, expect } from "vitest";
import {
  definitionLimitsFromConfig,
  loadServerConfig,
  redactServerConfig,
} from "./server-config.js";
import type { ConfigError, ServerConfig } from "./server-config.js";

const SECRET = "s3cr3t-value-0123456789";
const ENV = { KEY: SECRET };
const MIN =
  'auth:\n  mode: static-api-key\n  keys:\n    - {id: host, secret: "${KEY}", can: [propose]}\n';

function ok(
  text: string,
  env: Record<string, string | undefined> = ENV,
): ServerConfig {
  const r = loadServerConfig(text, env);
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.value;
}

function bad(
  text: string,
  env: Record<string, string | undefined> = ENV,
): readonly ConfigError[] {
  const r = loadServerConfig(text, env);
  if (r.ok) throw new Error(`expected failure, got ${JSON.stringify(r.value)}`);
  return r.error;
}

/** Text of an invalid config where the only change is `body` replacing a section. */
const withAuth = (extra: string): string => `${MIN}${extra}`;

const FULL = `
server:
  http: {host: 127.0.0.1, port: 9090}
  ws: {max_subscribers_per_session: 10, outbound_queue: 32}
auth:
  mode: static-api-key
  keys:
    - {id: host, secret: "\${KEY}", can: [propose, query, admin]}
    - {id: viewer, secret: "\${KEY2}", can: [subscribe]}
sessions:
  cache: {max_loaded: 100, idle_ttl: 2h}
  mailbox_limit: 7
store:
  kind: sqlite
  sqlite: {path: /var/e.db, journal: wal}
games:
  search_paths: [/a, /b]
limits:
  cascade_cap: {default: 8, max: 64}
  hook: {timeout: 2s, cost_budget: 5000}
logging: {level: debug, format: text}
`;

describe("VC-260 valid configs, defaults, camelCase, store union", () => {
  it("accepts a fully specified config", () => {
    const c = ok(FULL, { KEY: SECRET, KEY2: "another-secret-value-1" });
    expect(c).toEqual({
      server: {
        http: { host: "127.0.0.1", port: 9090 },
        ws: { maxSubscribersPerSession: 10, outboundQueue: 32 },
      },
      auth: {
        mode: "static-api-key",
        keys: [
          { id: "host", secret: SECRET, can: ["propose", "query", "admin"] },
          {
            id: "viewer",
            secret: "another-secret-value-1",
            can: ["subscribe"],
          },
        ],
      },
      sessions: {
        cache: { maxLoaded: 100, idleTtl: 7_200_000 },
        mailboxLimit: 7,
      },
      store: { kind: "sqlite", sqlite: { path: "/var/e.db", journal: "wal" } },
      games: { searchPaths: ["/a", "/b"] },
      limits: {
        cascadeCap: { default: 8, max: 64 },
        hook: { timeout: 2000, costBudget: 5000 },
      },
      logging: { level: "debug", format: "text" },
    });
  });

  it("fills every default for a minimal config (only auth)", () => {
    const c = ok(MIN);
    expect(c).toEqual({
      server: {
        http: { host: "0.0.0.0", port: 8080 },
        ws: { maxSubscribersPerSession: 200, outboundQueue: 256 },
      },
      auth: {
        mode: "static-api-key",
        keys: [{ id: "host", secret: SECRET, can: ["propose"] }],
      },
      sessions: {
        cache: { maxLoaded: 5000, idleTtl: 900_000 },
        mailboxLimit: 128,
      },
      store: {
        kind: "sqlite",
        sqlite: { path: "/data/engine.db", journal: "wal" },
      },
      games: { searchPaths: ["/app/games"] },
      limits: {
        cascadeCap: { default: 16, max: 256 },
        hook: { timeout: 250, costBudget: 2_000_000 },
      },
      logging: { level: "info", format: "json" },
    });
  });

  it("converts every duration unit to integer milliseconds", () => {
    const idle = (v: string) =>
      ok(withAuth(`sessions: {cache: {idle_ttl: ${v}}}\n`)).sessions.cache
        .idleTtl;
    expect(idle("15m")).toBe(900_000);
    expect(idle("1s")).toBe(1000);
    expect(idle("24h")).toBe(86_400_000);
    expect(idle("1500ms")).toBe(1500);
    const timeout = (v: string) =>
      ok(withAuth(`limits: {hook: {timeout: ${v}}}\n`)).limits.hook.timeout;
    expect(timeout("250ms")).toBe(250);
    expect(timeout("60s")).toBe(60_000);
    expect(timeout("1m")).toBe(60_000);
  });

  it("memory store has no sqlite property at all", () => {
    const c = ok(withAuth("store: {kind: memory}\n"));
    expect(c.store).toEqual({ kind: "memory" });
    expect(Object.hasOwn(c.store, "sqlite")).toBe(false);
  });

  it("sqlite store defaults its block when only kind or part of it is given", () => {
    expect(ok(withAuth("store: {kind: sqlite}\n")).store).toEqual({
      kind: "sqlite",
      sqlite: { path: "/data/engine.db", journal: "wal" },
    });
    expect(ok(withAuth("store: {sqlite: {path: /x.db}}\n")).store).toEqual({
      kind: "sqlite",
      sqlite: { path: "/x.db", journal: "wal" },
    });
  });

  it("builds DefinitionLimits and a redacted copy", () => {
    const c = ok(FULL, { KEY: SECRET, KEY2: "another-secret-value-1" });
    expect(definitionLimitsFromConfig(c)).toEqual({
      cascadeCapMax: 64,
      costBudgetMax: 5000,
    });
    const r = redactServerConfig(c);
    expect(JSON.stringify(r)).not.toContain(SECRET);
    expect(r.auth.keys.map((k) => k.secret)).toEqual([
      "<redacted>",
      "<redacted>",
    ]);
    expect(c.auth.keys[0]?.secret).toBe(SECRET);
  });
});

describe("VC-261 interpolation and redaction", () => {
  const two = (secret: string) =>
    `auth:\n  mode: static-api-key\n  keys:\n    - {id: host, secret: "${secret}", can: [propose]}\n`;

  it("substitutes ${A}-${B} in a string value (host)", () => {
    const c = ok(`server: {http: {host: "\${A}-\${B}"}}\n${MIN}`, {
      ...ENV,
      A: "alpha",
      B: "beta",
    });
    expect(c.server.http.host).toBe("alpha-beta");
  });

  it("reports ENV_MISSING naming variable and path, without values", () => {
    const e = bad(two("${MISSING}"), { OTHER: SECRET });
    expect(e).toHaveLength(1);
    expect(e[0]?.code).toBe("ENV_MISSING");
    expect(e[0]?.path).toBe("auth.keys[0].secret");
    expect(e[0]?.detail).toContain("MISSING");
    expect(JSON.stringify(e)).not.toContain(SECRET);
  });

  it("treats an undefined variable as missing and an empty one as present", () => {
    expect(bad(two("${X}"), { X: undefined })[0]?.code).toBe("ENV_MISSING");
    const e = bad(two("${X}"), { X: "" });
    expect(e).toEqual([
      expect.objectContaining({
        code: "CONFIG_INVALID",
        path: "auth.keys[0].secret",
      }),
    ]);
  });

  it("does not resolve inherited names such as constructor", () => {
    expect(bad(two("${constructor}"), {})[0]?.code).toBe("ENV_MISSING");
  });

  it.each(["${}", "${1X}", "${A", "$${A}"])(
    "malformed placeholder %s is ENV_SYNTAX",
    (s) => {
      const e = bad(two(s), { A: "valueA-valueA-valueA" });
      expect(e.map((x) => x.code)).toEqual(["ENV_SYNTAX"]);
      expect(e[0]?.path).toBe("auth.keys[0].secret");
      expect(JSON.stringify(e)).not.toContain("valueA");
    },
  );

  it("treats ${X} inside a key as a literal key, rejected as unknown", () => {
    const e = bad(`\${X}: 1\n${MIN}`, { ...ENV, X: "ignored-value" });
    expect(e).toEqual([
      expect.objectContaining({ code: "CONFIG_UNKNOWN_KEY", path: "${X}" }),
    ]);
  });

  it("redacts an interpolated invalid logging.level", () => {
    const e = bad(`logging: {level: "\${LVL}"}\n${MIN}`, {
      ...ENV,
      LVL: "trace",
    });
    expect(e).toHaveLength(1);
    expect(e[0]?.code).toBe("CONFIG_INVALID");
    expect(e[0]?.path).toBe("logging.level");
    expect(e[0]?.detail).toContain("<redacted>");
    expect(JSON.stringify(e)).not.toContain("trace");
  });

  it("redacts a partly interpolated value too", () => {
    const e = bad(`logging: {level: "x-\${LVL}"}\n${MIN}`, {
      ...ENV,
      LVL: "zzz",
    });
    expect(e[0]?.detail).toContain("<redacted>");
    expect(JSON.stringify(e)).not.toContain("zzz");
    expect(JSON.stringify(e)).not.toContain("x-");
  });

  it("does not redact a literal invalid value", () => {
    const e = bad(`logging: {level: trace}\n${MIN}`);
    expect(e[0]?.detail).toContain('"trace"');
  });

  it("a too-short secret fails without leaking it", () => {
    const short = "short-secret-01";
    const e = bad(two("${S}"), { S: short });
    expect(e[0]).toMatchObject({
      code: "CONFIG_INVALID",
      path: "auth.keys[0].secret",
    });
    expect(e[0]?.detail).toContain("<redacted>");
    expect(JSON.stringify(e)).not.toContain(short);
  });

  it("a literal secret is CONFIG_INVALID with the value redacted", () => {
    const e = bad(two("0123456789abcdef"));
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({
      code: "CONFIG_INVALID",
      path: "auth.keys[0].secret",
    });
    expect(e[0]?.detail).toContain("<redacted>");
    expect(JSON.stringify(e)).not.toContain("0123456789abcdef");
  });

  it("a secret that is not exactly one placeholder is rejected", () => {
    const e = bad(two("${A}${A}"), { A: "abcdefghijklmnop" });
    expect(e[0]?.path).toBe("auth.keys[0].secret");
    expect(JSON.stringify(e)).not.toContain("abcdefghijklmnop");
    expect(bad(two("pre-${A}"), { A: "abcdefghijklmnop" })).toHaveLength(1);
  });

  it("never prints a non-string secret or any env value in any error", () => {
    const env = { KEY: SECRET, LVL: "verbose-lvl", P: "relpath-val" };
    const text = [
      'server: {http: {host: "${P}", port: "${LVL}"}}',
      "auth:",
      "  mode: static-api-key",
      "  keys:",
      '    - {id: "${LVL}", secret: 12345678901234567890, can: [propose]}',
      '    - {id: ok, secret: "${KEY}", can: ["${LVL}"]}',
      'games: {search_paths: ["${P}"]}',
    ].join("\n");
    const e = bad(text, env);
    expect(e.length).toBeGreaterThan(3);
    const all = JSON.stringify(e);
    for (const v of [
      SECRET,
      "verbose-lvl",
      "relpath-val",
      "12345678901234567890",
    ]) {
      expect(all).not.toContain(v);
    }
  });

  it("forwards YAML errors with their YAML code", () => {
    expect(bad("a: [", ENV)[0]?.code).toBe("YAML_SYNTAX");
    expect(bad("a: 1\na: 2\n", ENV)[0]?.code).toBe("YAML_DUPLICATE_KEY");
    expect(bad("a: !!str x\n", ENV)[0]?.code).toBe("YAML_FORBIDDEN_FEATURE");
    expect(bad("a: " + "x".repeat(1_048_577), ENV)[0]?.code).toBe(
      "YAML_TOO_LARGE",
    );
  });

  it("never throws on odd roots", () => {
    for (const t of ["", "~", "[1]", "5", "just a string"]) {
      const r = loadServerConfig(t, ENV);
      expect(r.ok).toBe(false);
    }
  });
});

describe("VC-262 unknown keys, ranges, types, durations, enums, cap", () => {
  it("reports unknown keys at server, server.http, auth.keys[0] and top level", () => {
    const text = [
      "bogus: 1",
      "server:",
      "  extra: 1",
      "  http: {nope: 2}",
      "auth:",
      "  mode: static-api-key",
      "  keys:",
      '    - {id: host, secret: "${KEY}", can: [propose], weird: 1}',
    ].join("\n");
    const e = bad(text);
    expect(e.map((x) => [x.code, x.path]).sort()).toEqual(
      [
        ["CONFIG_UNKNOWN_KEY", "bogus"],
        ["CONFIG_UNKNOWN_KEY", "server.extra"],
        ["CONFIG_UNKNOWN_KEY", "server.http.nope"],
        ["CONFIG_UNKNOWN_KEY", "auth.keys[0].weird"],
      ].sort(),
    );
  });

  const invalid: [string, string, string][] = [
    ["port 0", "server: {http: {port: 0}}", "server.http.port"],
    ["port 65536", "server: {http: {port: 65536}}", "server.http.port"],
    ['port "8080"', 'server: {http: {port: "8080"}}', "server.http.port"],
    ["port 8080.5", "server: {http: {port: 8080.5}}", "server.http.port"],
    ["port 2_000_000", "server: {http: {port: 2_000_000}}", "server.http.port"],
    ["port null", "server: {http: {port: }}", "server.http.port"],
    [
      "idle_ttl 15",
      "sessions: {cache: {idle_ttl: 15}}",
      "sessions.cache.idle_ttl",
    ],
    [
      "idle_ttl 0s",
      "sessions: {cache: {idle_ttl: 0s}}",
      "sessions.cache.idle_ttl",
    ],
    [
      "idle_ttl 25h",
      "sessions: {cache: {idle_ttl: 25h}}",
      "sessions.cache.idle_ttl",
    ],
    [
      "idle_ttl 999ms",
      "sessions: {cache: {idle_ttl: 999ms}}",
      "sessions.cache.idle_ttl",
    ],
    [
      "idle_ttl 1.5s",
      "sessions: {cache: {idle_ttl: 1.5s}}",
      "sessions.cache.idle_ttl",
    ],
    ["timeout 61s", "limits: {hook: {timeout: 61s}}", "limits.hook.timeout"],
    ["timeout 0ms", "limits: {hook: {timeout: 0ms}}", "limits.hook.timeout"],
    ["timeout 5d", "limits: {hook: {timeout: 5d}}", "limits.hook.timeout"],
    [
      "cost_budget 0",
      "limits: {hook: {cost_budget: 0}}",
      "limits.hook.cost_budget",
    ],
    [
      "cascade max 4097",
      "limits: {cascade_cap: {max: 4097}}",
      "limits.cascade_cap.max",
    ],
    ["level trace", "logging: {level: trace}", "logging.level"],
    ["format xml", "logging: {format: xml}", "logging.format"],
    ["host empty", 'server: {http: {host: ""}}', "server.http.host"],
    ["mailbox 0", "sessions: {mailbox_limit: 0}", "sessions.mailbox_limit"],
    [
      "relative path",
      "games: {search_paths: [relative/path]}",
      "games.search_paths[0]",
    ],
    ["empty paths", "games: {search_paths: []}", "games.search_paths"],
    [
      "journal delete",
      "store: {sqlite: {journal: delete}}",
      "store.sqlite.journal",
    ],
    ["kind redis", "store: {kind: redis}", "store.kind"],
    ["server not a mapping", "server: 5", "server"],
  ];
  it.each(invalid)("%s is CONFIG_INVALID", (_n, extra, path) => {
    const e = bad(withAuth(`${extra}\n`));
    expect(e).toHaveLength(1);
    expect(e[0]?.code).toBe("CONFIG_INVALID");
    expect(e[0]?.path).toBe(path);
  });

  const authCases: [string, string, string][] = [
    [
      "mode oauth",
      'mode: oauth\n  keys: [{id: a, secret: "${KEY}", can: [propose]}]',
      "auth.mode",
    ],
    [
      "can root",
      'mode: static-api-key\n  keys: [{id: a, secret: "${KEY}", can: [root]}]',
      "auth.keys[0].can[0]",
    ],
    [
      "can empty",
      'mode: static-api-key\n  keys: [{id: a, secret: "${KEY}", can: []}]',
      "auth.keys[0].can",
    ],
    [
      "can duplicate",
      'mode: static-api-key\n  keys: [{id: a, secret: "${KEY}", can: [fork, fork]}]',
      "auth.keys[0].can",
    ],
    ["keys empty", "mode: static-api-key\n  keys: []", "auth.keys"],
    [
      "id bad charset",
      'mode: static-api-key\n  keys: [{id: "a b", secret: "${KEY}", can: [fork]}]',
      "auth.keys[0].id",
    ],
  ];
  it.each(authCases)("auth %s is CONFIG_INVALID", (_n, body, path) => {
    const e = bad(`auth:\n  ${body}\n`);
    expect(e.map((x) => x.path)).toEqual([path]);
    expect(e[0]?.code).toBe("CONFIG_INVALID");
  });

  it("secret length bounds: 15 and 257 invalid, 16 and 256 valid", () => {
    const run = (n: number) => loadServerConfig(MIN, { KEY: "k".repeat(n) });
    expect(run(15).ok).toBe(false);
    expect(run(257).ok).toBe(false);
    expect(run(16).ok).toBe(true);
    expect(run(256).ok).toBe(true);
    const e = run(257);
    if (!e.ok) {
      expect(e.error[0]?.path).toBe("auth.keys[0].secret");
      expect(JSON.stringify(e.error)).not.toContain("kkkk");
    }
  });

  it("accepts boundary values", () => {
    const c = ok(
      withAuth(
        "server: {http: {port: 65535}, ws: {outbound_queue: 100000, max_subscribers_per_session: 1}}\n" +
          "limits: {cascade_cap: {default: 1, max: 4096}, hook: {cost_budget: 9007199254740991}}\n",
      ),
    );
    expect(c.server.http.port).toBe(65535);
    expect(c.limits.hook.costBudget).toBe(9_007_199_254_740_991);
    expect(
      loadServerConfig(
        withAuth("limits: {hook: {cost_budget: 9007199254740992}}\n"),
        ENV,
      ).ok,
    ).toBe(false);
  });

  it("missing auth is CONFIG_MISSING; missing nested required keys too", () => {
    expect(bad("server: {}\n")).toEqual([
      expect.objectContaining({ code: "CONFIG_MISSING", path: "auth" }),
    ]);
    const e = bad("auth:\n  keys: [{id: a}]\n");
    expect(e.map((x) => [x.code, x.path])).toEqual([
      ["CONFIG_MISSING", "auth.mode"],
      ["CONFIG_MISSING", "auth.keys[0].secret"],
      ["CONFIG_MISSING", "auth.keys[0].can"],
    ]);
  });

  it("caps 120 independent errors at 100", () => {
    const keys = Array.from(
      { length: 120 },
      (_v, i) => `    - {id: k${String(i)}, secret: "\${KEY}", can: [root]}`,
    ).join("\n");
    const e = bad(`auth:\n  mode: static-api-key\n  keys:\n${keys}\n`);
    expect(e).toHaveLength(100);
    expect(new Set(e.map((x) => x.code))).toEqual(new Set(["CONFIG_INVALID"]));
    expect(e[0]?.path).toBe("auth.keys[0].can[0]");
  });

  it("collects errors from several sections in one pass", () => {
    const e = bad(
      withAuth("server: {http: {port: 0}}\nlogging: {level: x}\nzzz: 1\n"),
    );
    expect(e.map((x) => x.path).sort()).toEqual(
      ["logging.level", "server.http.port", "zzz"].sort(),
    );
  });
});

describe("VC-263 cross-field rules", () => {
  it("cascade_cap.default above max names both paths", () => {
    const e = bad(
      withAuth("limits: {cascade_cap: {default: 300, max: 256}}\n"),
    );
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({
      code: "CONFIG_INVALID",
      path: "limits.cascade_cap.default",
    });
    expect(e[0]?.detail).toContain("limits.cascade_cap.max");
  });

  it("a default above 256 is invalid even when max allows it", () => {
    const e = bad(
      withAuth("limits: {cascade_cap: {default: 300, max: 4096}}\n"),
    );
    expect(e).toHaveLength(1);
    expect(e[0]?.path).toBe("limits.cascade_cap.default");
  });

  it("a lowered max below the implicit default 16 is rejected the same way", () => {
    const e = bad(withAuth("limits: {cascade_cap: {max: 8}}\n"));
    expect(e[0]?.path).toBe("limits.cascade_cap.default");
    expect(e[0]?.detail).toContain("limits.cascade_cap.max");
    expect(e[0]?.detail).toContain("default value");
  });

  it("store.sqlite with kind memory names store.sqlite", () => {
    const e = bad(
      withAuth("store: {kind: memory, sqlite: {path: /x.db, journal: wal}}\n"),
    );
    expect(e).toEqual([
      expect.objectContaining({ code: "CONFIG_INVALID", path: "store.sqlite" }),
    ]);
    expect(e[0]?.detail).toContain("store.kind");
    expect(bad(withAuth("store: {kind: memory, sqlite: {}}\n"))[0]?.path).toBe(
      "store.sqlite",
    );
  });

  it("duplicate key ids name both paths", () => {
    const e = bad(
      "auth:\n  mode: static-api-key\n  keys:\n" +
        '    - {id: dup, secret: "${KEY}", can: [fork]}\n' +
        '    - {id: other, secret: "${KEY}", can: [fork]}\n' +
        '    - {id: dup, secret: "${KEY}", can: [fork]}\n',
    );
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({
      code: "CONFIG_INVALID",
      path: "auth.keys[2].id",
    });
    expect(e[0]?.detail).toContain("auth.keys[0].id");
  });

  it("duplicate search paths name both paths (also after normalisation)", () => {
    const e = bad(withAuth("games: {search_paths: [/a, /b, /a/]}\n"));
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({
      code: "CONFIG_INVALID",
      path: "games.search_paths[2]",
    });
    expect(e[0]?.detail).toContain("games.search_paths[0]");
    expect(bad(withAuth("games: {search_paths: [/a, /a]}\n"))).toHaveLength(1);
  });

  it("reports several cross-field violations together", () => {
    const e = bad(
      withAuth(
        "limits: {cascade_cap: {default: 300, max: 256}}\n" +
          "store: {kind: memory, sqlite: {}}\n" +
          "games: {search_paths: [/a, /a]}\n",
      ),
    );
    expect(e.map((x) => x.path)).toEqual([
      "limits.cascade_cap.default",
      "store.sqlite",
      "games.search_paths[1]",
    ]);
  });
});
