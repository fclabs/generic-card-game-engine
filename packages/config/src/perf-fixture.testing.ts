import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildHookBundle } from "./bundle.js";

/** Name of game `n` of the VC-244 fixture (`perf-00` .. `perf-19`). */
export function perfGameName(n: number): string {
  return `perf-${String(n).padStart(2, "0")}`;
}

/** game.yaml of one VC-244 game: 52 generated cards, 6 zones, 4 counters, one bundle. */
export function perfGameYaml(name: string): string {
  return `id: ${name}
action_schema_version: 1
seats: { count: 2 }
zones:
  - { id: stock, ordering: ordered }
  - { id: discard, ordering: ordered }
  - { id: table, ordering: unordered }
  - { id: trash, ordering: unordered }
  - { id: "hand-{seat}", for_each: seat, owner_id: "{seat}", ordering: unordered }
cards:
  - generate:
      axes:
        - { name: suit, values: [S, H, D, C] }
        - { name: rank, values: { range: [1, 13] } }
      id: "{suit}{rank}"
      type: "{suit}"
      zone: stock
counters:
  - { id: pot, owner: table, min: 0, initial: 0 }
  - { id: "score-{seat}", for_each: seat, owner: player, owner_id: "{seat}", min: 0, initial: 0 }
  - { id: stock_size, derived: { zone_size: stock } }
hooks:
  module: ./hooks.ts
  validation: { play_card: validatePlay }
  reaction: { "trigger:setup": onSetup }
`;
}

/** hooks.ts whose built bundle is about 4 KiB. */
export function perfHooksSource(): string {
  const pad = "x".repeat(3950);
  return `const PAD = "${pad}";
export function validatePlay(): boolean {
  return PAD.length > 0;
}
export function onSetup(): number {
  return PAD.length;
}
`;
}

/** Writes the 20-game VC-244 search path under `root` and builds every bundle. */
export async function writePerfGames(root: string, count = 20): Promise<void> {
  for (let n = 0; n < count; n++) {
    const name = perfGameName(n);
    const dir = join(root, name);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "game.yaml"), perfGameYaml(name));
    await writeFile(join(dir, "hooks.ts"), perfHooksSource());
    const built = await buildHookBundle(dir);
    if (!built.ok) {
      throw new Error(
        `perf game ${name} failed to build: ${JSON.stringify(built.error)}`,
      );
    }
  }
}
