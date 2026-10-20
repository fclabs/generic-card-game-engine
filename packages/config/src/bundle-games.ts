import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { bundleGames } from "./bundle.js";

/**
 * `pnpm bundle:games [gamesRoot]` (DFR-046). Default root: `games` under the
 * current directory. Exits 1, naming every failing game, if any build fails.
 */
async function main(): Promise<number> {
  const root = resolve(process.argv[2] ?? "games");
  const isDirectory = await stat(root).then(
    (s) => s.isDirectory(),
    () => false,
  );
  if (!isDirectory) {
    console.log(
      `bundle:games: no games directory at ${root}; nothing to build`,
    );
    return 0;
  }
  const outcomes = await bundleGames(root);
  if (outcomes.length === 0) {
    console.log(`bundle:games: no game declares hooks.module in ${root}`);
    return 0;
  }
  let failed = false;
  for (const outcome of outcomes) {
    if (outcome.ok) {
      console.log(
        `bundle:games: built ${outcome.game} (${String(outcome.info.exports.length)} exports, ${outcome.info.hash})`,
      );
    } else {
      failed = true;
      for (const e of outcome.errors) {
        console.error(
          `bundle:games: ${outcome.game}: ${e.path}: ${e.code}: ${e.detail}`,
        );
      }
    }
  }
  return failed ? 1 : 0;
}

process.exitCode = await main();
