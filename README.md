# Generic Card Game Engine

A TypeScript workspace for a deterministic, hexagonal card-game engine.
`packages/core` holds the domain kernel: a pure, synchronous, deterministic
state-transition function with canonical state digests (see
[docs/domain-kernel.md](docs/domain-kernel.md)), plus the pure compiler that
turns a game's `game.yaml` into a content-addressed definition. It also holds
the read side: a projector that gives each viewer only what its role is entitled
to (see [docs/visibility.md](docs/visibility.md)) and a hook-free replayer, replay
package format and forker (see [docs/replay-package.md](docs/replay-package.md)).
`packages/config` loads game definitions from disk (safe YAML, hook bundles,
a filesystem registry) and validates the server configuration (see
[docs/game-definitions.md](docs/game-definitions.md)). The other packages under
`packages/` are still empty skeletons. The layout, build, lint, layering and
determinism rules are wired and enforced so later work cannot quietly break
them.

Supported platforms: **macOS** and **Linux** only (no Windows).

## Prerequisites

- **Node** `22.23.3` (see `.nvmrc`; engines `>=22 <23`)
- **pnpm** `10.15.1` (via `packageManager` / Corepack)
- **Docker** (for containerised tests and the runtime image)

On macOS with Homebrew `node@22`:

```sh
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
```

## Quick start

```sh
pnpm install --frozen-lockfile
pnpm lint && pnpm typecheck && pnpm depcheck
pnpm test:all
docker compose -f deploy/docker-compose.test.yml run --rm tests
```

Check game definitions and the server configuration (see
[docs/dev-setup.md](docs/dev-setup.md)):

```sh
pnpm bundle:games
ENGINE_HOST_KEY=0123456789abcdef pnpm config:check
```

## Documentation

| Doc                                                              | Contents                                                     |
| ---------------------------------------------------------------- | ------------------------------------------------------------ |
| [docs/dev-setup.md](docs/dev-setup.md)                           | Versions, every root script, Docker commands, onboarding     |
| [docs/workspace-architecture.md](docs/workspace-architecture.md) | Package layering, determinism, Docker, CI rationale          |
| [docs/domain-kernel.md](docs/domain-kernel.md)                   | Domain kernel: usage, guarantees, errors, architecture       |
| [docs/game-definitions.md](docs/game-definitions.md)             | Game directories, identity, hook bundles, the registry       |
| [docs/game-definition-schema.md](docs/game-definition-schema.md) | Every `game.yaml` key, range, default and error code         |
| [docs/server-config.md](docs/server-config.md)                   | `server.yaml` keys, `${ENV}` rules, `pnpm config:check`      |
| [docs/visibility.md](docs/visibility.md)                         | Roles, entitlements, `View`/`Delta`, grants, worked examples |
| [docs/replay-package.md](docs/replay-package.md)                 | Replay package format, replay, fork, version policy          |
| [docs/canonical-json-profile.md](docs/canonical-json-profile.md) | Frozen canonical JSON profile v1 behind state digests        |
| [docs/troubleshooting.md](docs/troubleshooting.md)               | Limits and common failures                                   |
| [docs/architecture.md](docs/architecture.md)                     | Product architecture (package layout, domain rules)          |
| [docs/design.md](docs/design.md)                                 | Design notes                                                 |
