# Server configuration (`config/server.yaml`)

Reference for the file an operator writes to configure the engine server: every key with its type, range and default, how `${ENV}` interpolation works, what is redacted from error messages, a complete example, and how to check a configuration before starting anything with `pnpm config:check`.

The loader lives in `packages/config` (`loadServerConfig`). It validates and returns a value or a list of errors; it never starts, stops or exits anything. The server (a later phase) turns an error list into a refusal to start. For game definitions, see [game-definition-schema.md](./game-definition-schema.md) and [game-definitions.md](./game-definitions.md).

## How the file is read

1. The text is parsed with the same safe YAML rules as game definitions: YAML 1.2 core schema, at most 1 MiB, no tags, no merge keys, no duplicate keys, one document, at most 100 aliases. Parse failures keep their `YAML_*` code.
2. `${NAME}` placeholders in string **values** are replaced from the environment (see [Interpolation](#interpolation)).
3. The result is validated against a strict schema (below). Unknown keys, wrong types and out-of-range values are errors.
4. Cross-field rules run (only when every field passed on its own).
5. Defaults are filled in, keys become camelCase and durations become integer milliseconds.

The loader is pure: it takes the file **text** and an `env` object (`Readonly<Record<string, string | undefined>>`), never reads files or `process.env` itself and never throws. All errors are collected, up to 100.

## Keys

Ranges and defaults below are exact. Integers must be YAML integers: `8080` is valid, `"8080"` and `2_000_000` are not (the latter is not a YAML 1.2 integer; write `2000000`). A duration is a string matching `^[1-9][0-9]*(ms|s|m|h)$`, for example `250ms`, `30s`, `15m`, `2h`.

| Key | Type / range | Default |
|-----|--------------|---------|
| `server.http.host` | non-empty string | `0.0.0.0` |
| `server.http.port` | integer 1 to 65535 | `8080` |
| `server.ws.max_subscribers_per_session` | integer 1 to 10 000 | `200` |
| `server.ws.outbound_queue` | integer 1 to 100 000 | `256` |
| `auth.mode` | `static-api-key` | **required** |
| `auth.keys` | non-empty list of `{id, secret, can}` | **required** |
| `auth.keys[].id` | 1 to 128 characters of `A-Z a-z 0-9 _ . : / -`; distinct across keys | **required** |
| `auth.keys[].secret` | 16 to 256 characters after interpolation; the YAML source must be exactly one `${NAME}` | **required** |
| `auth.keys[].can` | non-empty list of distinct values from `propose`, `query`, `subscribe`, `export`, `direct_apply`, `fork`, `admin` | **required** |
| `sessions.cache.max_loaded` | integer 1 to 1 000 000 | `5000` |
| `sessions.cache.idle_ttl` | duration 1s to 24h | `15m` |
| `sessions.mailbox_limit` | integer 1 to 100 000 | `128` |
| `store.kind` | `sqlite` or `memory` | `sqlite` |
| `store.sqlite.path` | non-empty string; only with `kind: sqlite` | `/data/engine.db` |
| `store.sqlite.journal` | `wal`; only with `kind: sqlite` | `wal` |
| `games.search_paths` | non-empty list of distinct absolute paths | `[/app/games]` |
| `limits.cascade_cap.default` | integer, at most `limits.cascade_cap.max` and at most 256 | `16` |
| `limits.cascade_cap.max` | integer 1 to 4096 | `256` |
| `limits.hook.timeout` | duration 1ms to 60s | `250ms` |
| `limits.hook.cost_budget` | integer 1 to 2^53 - 1 | `2000000` |
| `logging.level` | `debug`, `info`, `warn` or `error` | `info` |
| `logging.format` | `json` or `text` | `json` |

Only `auth` is required; every other section and key may be left out.

### Cross-field rules

Each violation is a `CONFIG_INVALID` naming the paths involved.

| Rule | Reported at |
|------|-------------|
| `limits.cascade_cap.default` must not exceed `limits.cascade_cap.max` (also when `max` is lowered below the implicit default of 16) and must be at most 256 | `limits.cascade_cap.default`, the detail names `limits.cascade_cap.max` |
| `store.sqlite` must not be given together with `store.kind: memory` | `store.sqlite`, the detail names `store.kind` |
| `auth.keys[].id` values are distinct | the later `auth.keys[i].id`, the detail names the first |
| `games.search_paths` are distinct after normalisation (`/a` and `/a/` are the same) | the later `games.search_paths[i]`, the detail names the first |

### The loaded value

`loadServerConfig` returns a `ServerConfig`: the same structure with camelCase keys (`server.ws.maxSubscribersPerSession`, `sessions.cache.idleTtl`, `limits.hook.costBudget`, ...), durations as integer milliseconds (`idleTtl: 900000`, `timeout: 250`) and every default filled in. The key names `idleTtl` and `timeout` keep their YAML spelling. `store` is a union: `{kind: 'memory'}` (no `sqlite` property at all) or `{kind: 'sqlite', sqlite: {path, journal}}`. `auth.keys[].secret` holds the **resolved** secret, so never log a `ServerConfig` directly.

Helpers exported from `@cge/config` next to the loader:

| Export | Purpose |
|--------|---------|
| `redactServerConfig(config)` | Copy of the config with every secret replaced by `<redacted>`. The only form that should ever be logged. |
| `definitionLimitsFromConfig(config)` | The engine ceilings the definition compiler and the registry need: `{cascadeCapMax: limits.cascadeCap.max, costBudgetMax: limits.hook.costBudget}`. A game may lower these limits, never exceed them. |
| `REDACTED`, `CONFIG_ERROR_CODES`, `SERVER_CAPABILITIES` | The redaction text, the list of error codes and the list of capabilities. |

## Interpolation

- A string value may contain `${NAME}`, where `NAME` matches `^[A-Za-z_][A-Za-z0-9_]*$`. Each occurrence is replaced by the value of that environment variable. An **empty** string counts as set.
- Interpolation applies to **values only**, never to keys: a key such as `${X}` stays a literal key (and is rejected as unknown).
- It is the only templating: no defaults (`${A:-b}`), no nesting and no escapes. Every `${` must start a well-formed placeholder and must not be directly preceded by `$`, so `$${A}` is a syntax error. A `$` that is not followed by `{` is a literal.
- A variable that is not set (`undefined`) is `ENV_MISSING`, naming the variable and the path. A malformed placeholder (`${}`, `${1X}`, `${A`, `$${A}`) is `ENV_SYNTAX`, giving only the offset.
- Names are looked up as own properties of `env`, so `${constructor}` or `${__proto__}` are `ENV_MISSING`.
- If any `ENV_MISSING` or `ENV_SYNTAX` exists, those errors are returned alone, because the other values are not resolved yet.
- **Quote placeholders in flow mappings.** Inside `{ ... }` an unquoted `${KEY}` is a YAML syntax error. Write `{ id: host, secret: "${ENGINE_HOST_KEY}" }`, or use block style.
- **Secrets only through the environment.** `auth.keys[].secret` must be exactly one `${NAME}`. A literal secret, or a placeholder mixed with other text, is `CONFIG_INVALID` with the value shown as `<redacted>`.

## Redaction

No error message ever contains a secret or the value of an environment variable.

- In a `CONFIG_INVALID` detail, `expected <expectation>; got <value>`, the value is replaced by `<redacted>` when it came wholly or partly from interpolation, or when the path is `auth.keys[n].secret`. So `logging.level: ${LVL}` with `LVL=trace` reports `expected one of debug, info, warn, error; got <redacted>` and never `trace`.
- Other offending values are shown (strings quoted and cut at 40 characters; mappings and lists as "a mapping" and "a list").
- `ENV_MISSING` names the variable (`environment variable NAME is not set`), never a value; `ENV_SYNTAX` gives an offset only.
- Zod's own messages are never shown: every error carries the loader's own expectation text.

## Errors

`ConfigError` is `{code, path, detail}`. The path is dotted with `[i]` for list items (`auth.keys[0].secret`, `games.search_paths[2]`), and `""` for the document root. The codes (`CONFIG_ERROR_CODES`):

| Code | Triggered by |
|------|--------------|
| `YAML_SYNTAX`, `YAML_TOO_LARGE`, `YAML_DUPLICATE_KEY`, `YAML_FORBIDDEN_FEATURE` | The YAML intake rules (same meaning as in [game-definition-schema.md](./game-definition-schema.md#raised-while-reading-yaml-parseyaml)). |
| `ENV_MISSING` | `${NAME}` where `NAME` is not set in the environment. |
| `ENV_SYNTAX` | A `${` that does not start a well-formed placeholder. |
| `CONFIG_UNKNOWN_KEY` | A key the schema does not know, at any level; the path is `<parent>.<key>`. |
| `CONFIG_INVALID` | A wrong type, an out-of-range value, a bad enum, a bad duration, a literal secret, or a cross-field violation. |
| `CONFIG_MISSING` | A required key that is absent (`auth`, `auth.mode`, `auth.keys`, and the required fields of each key). |

Examples of what is rejected: `port: 0`, `65536`, `"8080"`, `8080.5`; `idle_ttl: 15` (no unit), `0s`, `25h`; `mode: oauth`; `can: [root]`, `can: []`; `keys: []`; a secret of 15 or 257 characters; `search_paths: [relative/path]`; `level: trace`.

## Example

A complete configuration (this is also close to the file shipped as `config/server.yaml`; the doc test loads it):

```yaml
server:
  http:
    host: 0.0.0.0
    port: 8080
  ws:
    max_subscribers_per_session: 200
    outbound_queue: 256

auth:
  mode: static-api-key
  keys:
    - id: host
      secret: "${ENGINE_HOST_KEY}"
      can: [propose, query, subscribe, export, direct_apply, fork, admin]

sessions:
  cache:
    max_loaded: 5000
    idle_ttl: 15m
  mailbox_limit: 128

store:
  kind: sqlite
  sqlite:
    path: /data/engine.db
    journal: wal

games:
  search_paths: [/app/games]

limits:
  cascade_cap:
    default: 16
    max: 256
  hook:
    timeout: 250ms
    cost_budget: 2000000

logging:
  level: info
  format: json
```

A memory-backed configuration for tests needs only `auth` and `store: {kind: memory}`; with `kind: memory` do not add a `sqlite` block.

### The sample file and Docker

`config/server.yaml` in the repository is the sample the `engine` service of `deploy/docker-compose.yml` mounts read-only at `/etc/engine/server.yaml`. It contains no secret: the key comes from `ENGINE_HOST_KEY` (16 to 256 characters). Compose passes `ENGINE_HOST_KEY: ${ENGINE_HOST_KEY:-}`, so when the variable is not exported on the host the container receives an **empty string**, not an unset variable. The result is a redacted `CONFIG_INVALID` at `auth.keys[0].secret` (expected a string of 16 to 256 characters; got `<redacted>`), not `ENV_MISSING`. Both mean "set `ENGINE_HOST_KEY`".

## Checking a configuration: `pnpm config:check`

```sh
export ENGINE_HOST_KEY=0123456789abcdef          # any 16 to 256 characters
pnpm config:check                                # config/server.yaml and its games.search_paths
pnpm config:check --server path/to/server.yaml   # another file
pnpm config:check --games games other/games      # check these game directories instead
```

`pnpm config:check` is `pnpm build && node packages/config/dist/cli.js`; further arguments are passed to the CLI. It loads the server config with `process.env`, then builds the filesystem definition registry over the search paths (the `--games` directories, or `games.search_paths` of the config) with the ceilings from `definitionLimitsFromConfig`. So one command validates the file, the environment and every game the server would load.

| Flag | Meaning |
|------|---------|
| `--server <path>` | Server config file; default `config/server.yaml` relative to the working directory. |
| `--games <dir>...` | One or more game search paths (every following argument that does not start with `--`); resolved against the working directory. Replaces `games.search_paths`. |

| Exit code | Meaning | Output |
|-----------|---------|--------|
| `0` | The configuration is valid and every game compiles | stdout: `OK <n> definitions` |
| `1` | At least one validation error, including an unreadable `--server` file | stderr: one `<path>: <code>: <detail>` line per error |
| `2` | Bad command line (unknown flag, `--server` without a value, `--games` without a directory) | stderr: the problem and the usage line |

Notes:

- Config errors print the key path (`auth.keys[0].secret: CONFIG_INVALID: ...`); a root-level error prints the file path. Game errors print the directory-prefixed path (`games/hearts/zones[0].ordering: INVALID_VALUE: ...`). Nothing from the configuration is printed on success, and no secret or environment value is ever printed.
- **Host fallback for a missing `/app/games`.** The sample config says `games.search_paths: [/app/games]`, a directory that exists in the Docker image but normally not on a developer machine. When `--games` is **not** given, `config:check` skips each configured search path that is not a directory, printing `warning: <path>: SEARCH_PATH_MISSING: configured search path does not exist on this host; skipped ...` to stderr. If none remains it checks `./games` instead (`warning: no configured search path exists on this host; checking <dir> instead`). If `./games` does not exist either, the configured paths are passed on and the registry reports `SEARCH_PATH_MISSING` (exit `1`). Warnings never change the exit code. A `--games` directory is never softened: a missing one is an error. Inside the container nothing is skipped, because `/app/games` always exists. (The server itself, unlike `config:check`, must refuse to start when a search path is missing.)
- It runs inside the runtime image too: `node packages/config/dist/cli.js --server /etc/engine/server.yaml`.

## Troubleshooting

| Symptom | Cause and fix |
|---------|---------------|
| `ENV_MISSING` naming `ENGINE_HOST_KEY` | The variable is not exported in the shell that runs the command. |
| `CONFIG_INVALID` at `auth.keys[0].secret`, `got <redacted>` | The variable is set but empty or outside 16 to 256 characters (this is also what Docker Compose produces for an unexported variable), or the secret is a literal instead of a single `${NAME}`. |
| A YAML syntax error on a `secret:` line inside `{ ... }` | The placeholder is not quoted; write `"${NAME}"`. |
| `CONFIG_UNKNOWN_KEY` | A misspelt key (the schema is strict) or a `${X}` used as a key. |
| `CONFIG_INVALID` on a number | The value is a string (`"8080"`), a float or written with underscores. |
| `CONFIG_INVALID` at `store.sqlite` | `sqlite` settings next to `kind: memory`. |
| Warnings about `SEARCH_PATH_MISSING` on your machine | Expected outside Docker; pass `--games <dir>` to check a specific directory. |
