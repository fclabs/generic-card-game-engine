# Iteration 6: DefinitionRegistry port, config package preparation and guardrail updates

Commit: see `git log` (message `Phase 2 iteration 6: DefinitionRegistry port, config package preparation and guardrail updates`).

## Criteria
- VC-240 PASS: `pnpm build && pnpm exec vitest run packages/core/src/ports`: type test of `RegistryError`, `DefinitionSummary`, `DefinitionRegistry` (`resolve` parameters and return type); `dist/ports/{index,types}.js` contain no `class`/`function`; package root exposes no runtime registry value; P1 VC-085 test (extended with the registry stub, known + unknown id) and "exports no runtime value" still pass.
- VC-270 PASS: `git diff -- tools/guardrails` shows only: skeleton-purity exemption, check 6 exception + constant, 5 new unit tests (config skeleton exemption; `yaml` in `packages/app` fails; `lodash` in config fails; `^2.8.1` yaml fails; exact `yaml`/`zod`/`esbuild` pass) and 1 depcruise case/fixture. Check 5 and every other test untouched. `pnpm test:guardrails`: 174 pass (was 168).
- VC-274 PASS: `packages/config/tsconfig.json` `types: ["node"]`; `packages/core/tsconfig.json` still `types: []` (unchanged); depcruise fixture `core-no-node-definition-node-fs` expects exactly `core-no-node` and passes.
- Config code allowed PASS: temporary `packages/config/src/index.ts` with `import { readFileSync } from "node:fs"` plus an exported function passed `pnpm build && pnpm lint && pnpm typecheck && pnpm depcheck && pnpm test:guardrails`; reverted to `export {};`.
- Gates PASS: `pnpm build && pnpm lint && pnpm typecheck && pnpm depcheck && pnpm test && pnpm test:guardrails` exit 0 (907 tests; 174 guardrails).
- Artifacts PASS: CONTEXT.md, DECISIONS.md D-017, D-018, this record.

## Files
- Changed: `packages/core/src/ports/{types,index,ports.testing,ports.test}.ts`, `packages/config/tsconfig.json`, `tools/guardrails/{repo-invariants,repo-invariants.test,depcruise-cases}.ts`, artifacts.
- Added: `tools/guardrails/fixtures/depcruise/core-no-node-definition-node-fs/` (package.json, `src/definition/x.ts`).
- No dependency added; `pnpm-lock.yaml` untouched.

## Deviations
- None. `packages/config/tsconfig.test.json` already had `types: ["node"]`; ESLint and `.dependency-cruiser.cjs` needed no change (probed with a node import).

## Gotchas
- The emitted-JS assertion reads `packages/core/dist`; run `pnpm build` before a bare `vitest run`.
- `core-no-node-node-fs` (Phase 0, `src/x.ts`) is kept; the new fixture is a sibling, not a replacement.

## For the next iteration
- Check 6 text, the dependency-adding procedure, the `DefinitionRegistry` signature and the node-types fact are in `CONTEXT.md` (sections "registry port" and "Guardrail and package state").
- Iteration 7 adds `yaml` with an exact version via `pnpm --filter @cge/config add --save-exact yaml@<ver>` and commits the lockfile; it is the first code in `packages/config/src` (skeleton purity no longer applies there). `@cge/config` may import `node:*`.
- Check 7 is untouched: adding a root script still requires `docs/dev-setup.md`.
