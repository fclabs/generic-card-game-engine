import { runConfigCheck } from "./config-check.js";

/** Entry for `pnpm config:check`; the only place that reads `process.env`. */
const result = await runConfigCheck(process.argv.slice(2), process.env);
for (const line of result.stdout) {
  console.log(line);
}
for (const line of result.stderr) {
  console.error(line);
}
process.exitCode = result.exitCode;
