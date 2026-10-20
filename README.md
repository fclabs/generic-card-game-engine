# Generic Card Game Engine

A TypeScript workspace for a deterministic, hexagonal card-game engine.
`packages/core` holds the domain kernel: a pure, synchronous, deterministic
state-transition function with canonical state digests (see
[docs/domain-kernel.md](docs/domain-kernel.md)). The other packages under
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

## Documentation

| Doc                                                              | Contents                                                 |
| ---------------------------------------------------------------- | -------------------------------------------------------- |
| [docs/dev-setup.md](docs/dev-setup.md)                           | Versions, every root script, Docker commands, onboarding |
| [docs/workspace-architecture.md](docs/workspace-architecture.md) | Package layering, determinism, Docker, CI rationale      |
| [docs/domain-kernel.md](docs/domain-kernel.md)                   | Domain kernel: usage, guarantees, errors, architecture   |
| [docs/canonical-json-profile.md](docs/canonical-json-profile.md) | Frozen canonical JSON profile v1 behind state digests    |
| [docs/troubleshooting.md](docs/troubleshooting.md)               | Limits and common failures                               |
| [docs/architecture.md](docs/architecture.md)                     | Product architecture (package layout, domain rules)      |
| [docs/design.md](docs/design.md)                                 | Design notes                                             |
