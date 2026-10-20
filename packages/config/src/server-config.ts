import { isAbsolute, normalize } from "node:path";
import { z } from "zod";
import { MAX_DEFINITION_ERRORS } from "@cge/core";
import type { DefinitionLimits, JsonValue, Result } from "@cge/core";
import { parseYaml } from "./yaml.js";

/** Text that replaces a secret or an environment-derived value in any message. */
export const REDACTED = "<redacted>";

export const CONFIG_ERROR_CODES = [
  "YAML_SYNTAX",
  "YAML_TOO_LARGE",
  "YAML_DUPLICATE_KEY",
  "YAML_FORBIDDEN_FEATURE",
  "ENV_MISSING",
  "ENV_SYNTAX",
  "CONFIG_UNKNOWN_KEY",
  "CONFIG_INVALID",
  "CONFIG_MISSING",
] as const;
export type ConfigErrorCode = (typeof CONFIG_ERROR_CODES)[number];

/** A server configuration failure. `path` is dotted/indexed (`auth.keys[0].secret`), `""` for the root. */
export interface ConfigError {
  readonly code: ConfigErrorCode;
  readonly path: string;
  readonly detail: string;
}

export const SERVER_CAPABILITIES = [
  "propose",
  "query",
  "subscribe",
  "export",
  "direct_apply",
  "fork",
  "admin",
] as const;
export type ServerCapability = (typeof SERVER_CAPABILITIES)[number];

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFormat = "json" | "text";

export interface ServerAuthKey {
  readonly id: string;
  /** The resolved secret (from the environment). Never log it; see `redactServerConfig`. */
  readonly secret: string;
  readonly can: readonly ServerCapability[];
}

export type ServerStoreConfig =
  | { readonly kind: "memory" }
  | {
      readonly kind: "sqlite";
      readonly sqlite: { readonly path: string; readonly journal: "wal" };
    };

/** The validated server configuration: camelCase keys, durations in integer milliseconds, defaults filled. */
export interface ServerConfig {
  readonly server: {
    readonly http: { readonly host: string; readonly port: number };
    readonly ws: {
      readonly maxSubscribersPerSession: number;
      readonly outboundQueue: number;
    };
  };
  readonly auth: {
    readonly mode: "static-api-key";
    readonly keys: readonly ServerAuthKey[];
  };
  readonly sessions: {
    readonly cache: {
      readonly maxLoaded: number;
      /** Milliseconds. */
      readonly idleTtl: number;
    };
    readonly mailboxLimit: number;
  };
  readonly store: ServerStoreConfig;
  readonly games: { readonly searchPaths: readonly string[] };
  readonly limits: {
    readonly cascadeCap: { readonly default: number; readonly max: number };
    readonly hook: {
      /** Milliseconds. */
      readonly timeout: number;
      readonly costBudget: number;
    };
  };
  readonly logging: { readonly level: LogLevel; readonly format: LogFormat };
}

// ---------------------------------------------------------------------------
// Schema (strict; every failure carries our own expectation text, never zod's)
// ---------------------------------------------------------------------------

const ID_PATTERN = /^[A-Za-z0-9_.:/-]{1,128}$/;
const DURATION_PATTERN = /^([1-9][0-9]*)(ms|s|m|h)$/;
const UNIT_MS = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 } as const;

function int(min: number, max: number): z.ZodType<number> {
  return z.custom<number>(
    (v) =>
      typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max,
    { error: `an integer from ${String(min)} to ${String(max)}` },
  );
}

function oneOf<T extends string>(values: readonly T[]): z.ZodType<T> {
  return z.custom<T>(
    (v) => typeof v === "string" && (values as readonly string[]).includes(v),
    { error: `one of ${values.join(", ")}` },
  );
}

/** Duration text to integer milliseconds, or `undefined` when malformed or out of `[minMs, maxMs]`. */
function durationMs(
  text: unknown,
  minMs: number,
  maxMs: number,
): number | undefined {
  if (typeof text !== "string") return undefined;
  const m = DURATION_PATTERN.exec(text);
  if (m === null) return undefined;
  const unit = m[2] as keyof typeof UNIT_MS;
  const ms = Number(m[1]) * UNIT_MS[unit];
  return Number.isSafeInteger(ms) && ms >= minMs && ms <= maxMs
    ? ms
    : undefined;
}

function duration(
  minMs: number,
  maxMs: number,
  range: string,
): z.ZodType<string> {
  return z.custom<string>((v) => durationMs(v, minMs, maxMs) !== undefined, {
    error: `a duration like 250ms, 30s, 15m or 2h, ${range}`,
  });
}

const nonEmptyString = z.custom<string>(
  (v) => typeof v === "string" && v.length > 0,
  { error: "a non-empty string" },
);

const keySchema = z.strictObject({
  id: z.custom<string>((v) => typeof v === "string" && ID_PATTERN.test(v), {
    error: "an id of 1-128 characters from A-Z a-z 0-9 _ . : / -",
  }),
  secret: z.custom<string>(
    (v) => typeof v === "string" && v.length >= 16 && v.length <= 256,
    { error: "a string of 16 to 256 characters" },
  ),
  can: z
    .array(oneOf(SERVER_CAPABILITIES))
    .min(1, "a non-empty list of capabilities")
    .refine((a) => new Set(a).size === a.length, "distinct capabilities"),
});

const serverConfigSchema = z.strictObject({
  server: z
    .strictObject({
      http: z
        .strictObject({
          host: nonEmptyString.optional(),
          port: int(1, 65535).optional(),
        })
        .optional(),
      ws: z
        .strictObject({
          max_subscribers_per_session: int(1, 10_000).optional(),
          outbound_queue: int(1, 100_000).optional(),
        })
        .optional(),
    })
    .optional(),
  auth: z.strictObject({
    mode: oneOf(["static-api-key"] as const),
    keys: z.array(keySchema).min(1, "a non-empty list of keys"),
  }),
  sessions: z
    .strictObject({
      cache: z
        .strictObject({
          max_loaded: int(1, 1_000_000).optional(),
          idle_ttl: duration(1000, 86_400_000, "from 1s to 24h").optional(),
        })
        .optional(),
      mailbox_limit: int(1, 100_000).optional(),
    })
    .optional(),
  store: z
    .strictObject({
      kind: oneOf(["sqlite", "memory"] as const).optional(),
      sqlite: z
        .strictObject({
          path: nonEmptyString.optional(),
          journal: oneOf(["wal"] as const).optional(),
        })
        .optional(),
    })
    .optional(),
  games: z
    .strictObject({
      search_paths: z
        .array(
          z.custom<string>((v) => typeof v === "string" && isAbsolute(v), {
            error: "an absolute path",
          }),
        )
        .min(1, "a non-empty list of absolute paths")
        .optional(),
    })
    .optional(),
  limits: z
    .strictObject({
      cascade_cap: z
        .strictObject({
          // Range 1-4096 here; `default <= max` and `default <= 256` are cross-field rules (DFR-073).
          default: int(1, 4096).optional(),
          max: int(1, 4096).optional(),
        })
        .optional(),
      hook: z
        .strictObject({
          timeout: duration(1, 60_000, "from 1ms to 60s").optional(),
          cost_budget: int(1, Number.MAX_SAFE_INTEGER).optional(),
        })
        .optional(),
    })
    .optional(),
  logging: z
    .strictObject({
      level: oneOf(["debug", "info", "warn", "error"] as const).optional(),
      format: oneOf(["json", "text"] as const).optional(),
    })
    .optional(),
});

type Parsed = z.infer<typeof serverConfigSchema>;

// ---------------------------------------------------------------------------
// Paths and values
// ---------------------------------------------------------------------------

type Segment = string | number;

function formatPath(segments: readonly PropertyKey[]): string {
  let out = "";
  for (const s of segments) {
    if (typeof s === "number") out += `[${String(s)}]`;
    else out += out === "" ? String(s) : `.${String(s)}`;
  }
  return out;
}

const SECRET_PATH = /^auth\.keys\[\d+\]\.secret$/;

function lookup(
  root: unknown,
  segments: readonly PropertyKey[],
): { found: boolean; value: unknown } {
  let cur = root;
  for (const s of segments) {
    if (Array.isArray(cur) && typeof s === "number") {
      if (s >= cur.length) return { found: false, value: undefined };
      cur = cur[s];
    } else if (
      typeof cur === "object" &&
      cur !== null &&
      typeof s === "string"
    ) {
      if (!Object.hasOwn(cur, s)) return { found: false, value: undefined };
      cur = (cur as Record<string, unknown>)[s];
    } else {
      return { found: false, value: undefined };
    }
  }
  return { found: true, value: cur };
}

/** Compact, content-free description of a value; strings are quoted and truncated. */
function describeValue(v: unknown): string {
  if (typeof v === "string") {
    return v.length > 40
      ? `${JSON.stringify(v.slice(0, 40)).slice(0, -1)}..."`
      : JSON.stringify(v);
  }
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v === null) return "null";
  if (Array.isArray(v)) return "a list";
  if (typeof v === "object") return "a mapping";
  return "nothing";
}

// ---------------------------------------------------------------------------
// Interpolation with per-value provenance
// ---------------------------------------------------------------------------

/** Provenance of one string value that came from `${NAME}` interpolation. */
interface Interpolated {
  /** The whole source string was exactly one placeholder. */
  readonly whole: boolean;
}

type Env = Readonly<Record<string, string | undefined>>;

const PLACEHOLDER = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/y;

function interpolateString(
  text: string,
  env: Env,
  path: string,
  errors: ConfigError[],
): { value: string; interpolated: Interpolated | undefined } {
  if (!text.includes("${")) return { value: text, interpolated: undefined };
  let out = "";
  let last = 0;
  let count = 0;
  let from = 0;
  for (;;) {
    const at = text.indexOf("${", from);
    if (at < 0) break;
    from = at + 2;
    if (at > 0 && text[at - 1] === "$") {
      errors.push({
        code: "ENV_SYNTAX",
        path,
        detail: `"$" directly before "\${" at offset ${String(at - 1)} (escapes are not supported)`,
      });
      continue;
    }
    PLACEHOLDER.lastIndex = at;
    const m = PLACEHOLDER.exec(text);
    if (m === null) {
      errors.push({
        code: "ENV_SYNTAX",
        path,
        detail: `malformed placeholder at offset ${String(at)} (expected \${NAME} with NAME matching [A-Za-z_][A-Za-z0-9_]*)`,
      });
      continue;
    }
    const name = m[1] as string;
    from = at + m[0].length;
    count += 1;
    const v = Object.hasOwn(env, name) ? env[name] : undefined;
    if (typeof v !== "string") {
      errors.push({
        code: "ENV_MISSING",
        path,
        detail: `environment variable ${name} is not set`,
      });
      continue;
    }
    out += text.slice(last, at) + v;
    last = from;
  }
  out += text.slice(last);
  const whole = count === 1 && PLACEHOLDER_WHOLE.test(text);
  return { value: out, interpolated: { whole } };
}

const PLACEHOLDER_WHOLE = /^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/;

function interpolate(
  value: JsonValue,
  env: Env,
  segments: Segment[],
  provenance: Map<string, Interpolated>,
  errors: ConfigError[],
): unknown {
  if (typeof value === "string") {
    const path = formatPath(segments);
    const r = interpolateString(value, env, path, errors);
    if (r.interpolated !== undefined) provenance.set(path, r.interpolated);
    return r.value;
  }
  if (Array.isArray(value)) {
    return (value as readonly JsonValue[]).map((item, i) =>
      interpolate(item, env, [...segments, i], provenance, errors),
    );
  }
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = interpolate(v, env, [...segments, k], provenance, errors);
    }
    return out;
  }
  return value;
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

/**
 * Parses, interpolates, validates and normalises `server.yaml` text. Pure and
 * total: never throws, never reads files or `process.env` (the caller passes
 * `env`). No error text contains an environment value or a secret.
 */
export function loadServerConfig(
  text: string,
  env: Env,
): Result<ServerConfig, readonly ConfigError[]> {
  try {
    return load(text, env);
  } catch {
    return fail([
      {
        code: "CONFIG_INVALID",
        path: "",
        detail: "the configuration could not be processed (internal failure)",
      },
    ]);
  }
}

function load(
  text: string,
  env: Env,
): Result<ServerConfig, readonly ConfigError[]> {
  const parsed = parseYaml(text);
  if (!parsed.ok) {
    return fail(
      parsed.error.map((e) => ({
        code: e.code as ConfigErrorCode,
        path: e.path,
        detail: e.detail,
      })),
    );
  }

  const errors: ConfigError[] = [];
  const provenance = new Map<string, Interpolated>();
  const data = interpolate(parsed.value, env, [], provenance, errors);
  if (errors.length > 0) return fail(errors);

  const redacted = (path: string): boolean =>
    provenance.has(path) || SECRET_PATH.test(path);

  // DBR-007: a secret's source must be exactly one placeholder.
  const sourceFailed = new Set<string>();
  const keys = lookup(data, ["auth", "keys"]);
  if (Array.isArray(keys.value)) {
    keys.value.forEach((key: unknown, i) => {
      const path = `auth.keys[${String(i)}].secret`;
      const secret = lookup(key, ["secret"]);
      if (secret.found && typeof secret.value === "string") {
        if (provenance.get(path)?.whole !== true) {
          sourceFailed.add(path);
          errors.push({
            code: "CONFIG_INVALID",
            path,
            detail: `expected exactly one \${NAME} placeholder (secrets come only from the environment); got ${REDACTED}`,
          });
        }
      }
    });
  }

  const result = serverConfigSchema.safeParse(data);
  if (!result.success) {
    for (const issue of result.error.issues) {
      if (issue.code === "unrecognized_keys") {
        for (const key of issue.keys) {
          errors.push({
            code: "CONFIG_UNKNOWN_KEY",
            path: formatPath([...issue.path, key]),
            detail: "unknown key",
          });
        }
        continue;
      }
      const path = formatPath(issue.path);
      if (sourceFailed.has(path)) continue;
      const found = lookup(data, issue.path);
      if (!found.found) {
        errors.push({
          code: "CONFIG_MISSING",
          path,
          detail: "required key is missing",
        });
        continue;
      }
      const expectation =
        issue.code === "invalid_type"
          ? issue.expected
          : issue.code === "custom" || issue.code === "too_small"
            ? issue.message
            : "a valid value";
      const shown = redacted(path) ? REDACTED : describeValue(found.value);
      errors.push({
        code: "CONFIG_INVALID",
        path,
        detail: `expected ${expectation}; got ${shown}`,
      });
    }
  }
  if (errors.length > 0) return fail(errors);
  if (!result.success) {
    return fail([
      { code: "CONFIG_INVALID", path: "", detail: "invalid configuration" },
    ]);
  }

  const config = normalize_(result.data);
  const cross = crossFieldErrors(result.data, config);
  if (cross.length > 0) return fail(cross);
  return { ok: true, value: config };
}

function fail(errors: readonly ConfigError[]): {
  ok: false;
  error: readonly ConfigError[];
} {
  return { ok: false, error: errors.slice(0, MAX_DEFINITION_ERRORS) };
}

// ---------------------------------------------------------------------------
// Defaults, camelCase, milliseconds
// ---------------------------------------------------------------------------

function normalize_(p: Parsed): ServerConfig {
  const storeKind = p.store?.kind ?? "sqlite";
  const store: ServerStoreConfig =
    storeKind === "memory"
      ? { kind: "memory" }
      : {
          kind: "sqlite",
          sqlite: {
            path: p.store?.sqlite?.path ?? "/data/engine.db",
            journal: p.store?.sqlite?.journal ?? "wal",
          },
        };
  return {
    server: {
      http: {
        host: p.server?.http?.host ?? "0.0.0.0",
        port: p.server?.http?.port ?? 8080,
      },
      ws: {
        maxSubscribersPerSession:
          p.server?.ws?.max_subscribers_per_session ?? 200,
        outboundQueue: p.server?.ws?.outbound_queue ?? 256,
      },
    },
    auth: {
      mode: p.auth.mode,
      keys: p.auth.keys.map((k) => ({
        id: k.id,
        secret: k.secret,
        can: [...k.can],
      })),
    },
    sessions: {
      cache: {
        maxLoaded: p.sessions?.cache?.max_loaded ?? 5000,
        idleTtl:
          durationMs(p.sessions?.cache?.idle_ttl ?? "15m", 1000, 86_400_000) ??
          900_000,
      },
      mailboxLimit: p.sessions?.mailbox_limit ?? 128,
    },
    store,
    games: { searchPaths: [...(p.games?.search_paths ?? ["/app/games"])] },
    limits: {
      cascadeCap: {
        default: p.limits?.cascade_cap?.default ?? 16,
        max: p.limits?.cascade_cap?.max ?? 256,
      },
      hook: {
        timeout:
          durationMs(p.limits?.hook?.timeout ?? "250ms", 1, 60_000) ?? 250,
        costBudget: p.limits?.hook?.cost_budget ?? 2_000_000,
      },
    },
    logging: {
      level: p.logging?.level ?? "info",
      format: p.logging?.format ?? "json",
    },
  };
}

// ---------------------------------------------------------------------------
// Cross-field rules (DFR-073)
// ---------------------------------------------------------------------------

function crossFieldErrors(p: Parsed, config: ServerConfig): ConfigError[] {
  const errors: ConfigError[] = [];
  const { default: def, max } = config.limits.cascadeCap;
  if (def > max) {
    const explicit = p.limits?.cascade_cap?.default !== undefined;
    errors.push({
      code: "CONFIG_INVALID",
      path: "limits.cascade_cap.default",
      detail: `${explicit ? "" : "the default value "}${String(def)} must not exceed limits.cascade_cap.max (${String(max)})`,
    });
  } else if (def > 256) {
    errors.push({
      code: "CONFIG_INVALID",
      path: "limits.cascade_cap.default",
      detail: `expected an integer from 1 to 256; got ${String(def)}`,
    });
  }
  if (p.store?.kind === "memory" && p.store.sqlite !== undefined) {
    errors.push({
      code: "CONFIG_INVALID",
      path: "store.sqlite",
      detail: "store.sqlite is not allowed together with store.kind: memory",
    });
  }
  const ids = new Map<string, number>();
  p.auth.keys.forEach((k, i) => {
    const first = ids.get(k.id);
    if (first === undefined) ids.set(k.id, i);
    else {
      errors.push({
        code: "CONFIG_INVALID",
        path: `auth.keys[${String(i)}].id`,
        detail: `duplicate key id ${JSON.stringify(k.id)}, already used by auth.keys[${String(first)}].id`,
      });
    }
  });
  const paths = new Map<string, number>();
  config.games.searchPaths.forEach((sp, i) => {
    const norm = normalizeSearchPath(sp);
    const first = paths.get(norm);
    if (first === undefined) paths.set(norm, i);
    else {
      errors.push({
        code: "CONFIG_INVALID",
        path: `games.search_paths[${String(i)}]`,
        detail: `duplicate search path ${JSON.stringify(sp)}, already listed at games.search_paths[${String(first)}]`,
      });
    }
  });
  return errors;
}

function normalizeSearchPath(p: string): string {
  const n = normalize(p);
  return n.length > 1 && n.endsWith("/") ? n.slice(0, -1) : n;
}

// ---------------------------------------------------------------------------
// Helpers for consumers
// ---------------------------------------------------------------------------

/** Copy of `config` that is safe to log: every secret is replaced by `<redacted>`. */
export function redactServerConfig(config: ServerConfig): ServerConfig {
  return {
    ...config,
    auth: {
      ...config.auth,
      keys: config.auth.keys.map((k) => ({ ...k, secret: REDACTED })),
    },
  };
}

/** The engine ceilings the definition compiler and registry need, from the server config (DBR-006). */
export function definitionLimitsFromConfig(
  config: ServerConfig,
): DefinitionLimits {
  return {
    cascadeCapMax: config.limits.cascadeCap.max,
    costBudgetMax: config.limits.hook.costBudget,
  };
}
