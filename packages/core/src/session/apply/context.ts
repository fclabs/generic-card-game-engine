import type { CompiledGameDefinition } from "../../definition/types.js";
import type { ErrorCode } from "../../errors/codes.js";
import { err } from "../../errors/result.js";
import type { Result } from "../../errors/result.js";
import type { DefIndex } from "./def-index.js";
import type { WorkingState } from "./working-state.js";

/** What a primitive handler sees. One context per primitive being applied. */
export interface ApplyContext {
  readonly def: CompiledGameDefinition;
  readonly index: DefIndex;
  readonly work: WorkingState;
  /** Zero-based index of the input action this primitive stems from (shared by macro expansions). */
  readonly inputIndex: number;
  /** Position this primitive takes in the committed list (grant ids use it, KFR-040). */
  readonly position: number;
  /** The `seq` this batch commits (`input seq + 1`). */
  readonly seq: number;
  /** Builds a failure carrying `actionIndex = inputIndex`; `path` defaults to none. */
  fail(code: ErrorCode, detail: string, path?: string): Result<never>;
  /** Path of a field of the current input action, e.g. `ctx.path(".to_position")` -> `$[2].to_position`. */
  path(suffix?: string): string;
}

export function makeContext(
  base: Omit<ApplyContext, "fail" | "path" | "inputIndex" | "position">,
  inputIndex: number,
  position: number,
): ApplyContext {
  return {
    ...base,
    inputIndex,
    position,
    fail(code, detail, path) {
      return err({
        code,
        detail,
        actionIndex: inputIndex,
        ...(path !== undefined ? { path } : {}),
      });
    },
    path(suffix = "") {
      return `$[${String(inputIndex)}]${suffix}`;
    },
  };
}
