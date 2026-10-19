# Troubleshooting

Operational limits and failures that show up often while working in this workspace.

## Known limits

- **Node 22 only.** The repo pins Node `22.23.3`. A newer system Node (for example 26.x) will disagree with `.nvmrc`, `engines`, and the Docker image. Activate Node 22 before every command (see [dev-setup.md](./dev-setup.md)).
- **macOS and Linux only.** Windows (native, WSL, Docker Desktop on Windows) is unsupported.
- **No host server config yet.** `config/server.yaml` is absent, so `docker compose -f deploy/docker-compose.yml up` cannot start the `engine` service. Use `docker compose -f deploy/docker-compose.yml config` to validate the compose file.
- **Runtime image is a placeholder.** The default command is `node packages/server/dist/index.js`, which currently exits 0 immediately. There is no `/healthz` / `/readyz` yet.
- **Remote CI timings and gating** (cold/warm container jobs on GitHub-hosted runners, cache-hit logs, “forbidden commit fails at lint and skips later jobs”) are verified statically in-repo; end-to-end proof waits for the first real pull request.

## Common gotchas

### Wrong Node on PATH

Symptoms: unexpected TypeScript/ESLint behaviour, or invariant failures about `.nvmrc` vs Docker. Fix: prepend the Node 22 binary directory (Homebrew example in [dev-setup.md](./dev-setup.md)) and re-check `node -v` / `pnpm -v`.

### Build runs before lint / depcheck / tests

`pnpm lint`, `pnpm depcheck`, `pnpm test`, and `pnpm test:guardrails` all start with `pnpm build`. A type error in a package source fails the script before ESLint or depcheck runs. For an isolated rule check on a throwaway file, use `pnpm exec eslint <path>` or `pnpm exec depcruise packages --config .dependency-cruiser.cjs`.

### Stale `dist/` or `*.tsbuildinfo`

After moving or deleting sources, an old emit can confuse resolution. Clean and rebuild:

```sh
rm -rf packages/*/dist packages/adapters/*/dist packages/*/*.tsbuildinfo packages/adapters/*/*.tsbuildinfo
pnpm build
```

### Compose image hides host edits

The `test` image bakes sources at build time (no bind mount). After changing tests or sources on the host, rebuild before `docker compose -f deploy/docker-compose.test.yml run --rm tests`, or rely on Compose’s build step when the Dockerfile context changed.

### Docker layer cache invalidation

- Source-only `.ts` edits should leave the `pnpm install` layer **CACHED**.
- Touching any `package.json`, `pnpm-lock.yaml`, or `pnpm-workspace.yaml` re-runs install.
- `.dockerignore` must keep the narrow re-include for guardrail fixture `dist` files; dropping it breaks a relative-into-dist layering check inside the container.

### pnpm / Corepack

Use the exact pnpm from `packageManager` (`10.15.1`). A globally installed newer pnpm can rewrite the lockfile. Prefer `corepack enable` and `corepack prepare pnpm@10.15.1 --activate`, and always `pnpm install --frozen-lockfile` in CI-like flows.

### Guardrail fixtures vs the real tree

Fixtures under `tools/guardrails/fixtures/` contain deliberately illegal code. They must never be picked up by `pnpm lint`, `pnpm depcheck`, or the unit Vitest config. If a real command suddenly fails mentioning a fixture path, an ignore/exclude regressed.

### ESLint / Prettier comment traps

Block comments must not contain the two-character sequence that closes a JSDoc/block comment mid-glob (for example writing star-slash next to a path glob). Prefer wording that avoids that sequence, or the toolchain fails to parse the file.

### JSDoc in invariant helpers

Same star-slash trap applies inside `tools/guardrails` sources consumed by Vitest’s parser.

### actionlint / workflow edits

`.github/**/*.yml` is formatted by Prettier (not ignored). After editing the workflow, run `pnpm format` (or format that file) before `pnpm format:check`.

## Quick health check

```sh
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"   # macOS Homebrew; adjust as needed
pnpm install --frozen-lockfile
pnpm lint && pnpm format:check && pnpm typecheck && pnpm depcheck
pnpm test:all
docker compose -f deploy/docker-compose.test.yml run --rm tests
```

All of the above should exit 0 on a clean tree.
