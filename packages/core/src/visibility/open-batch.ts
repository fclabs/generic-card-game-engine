import type { Transaction } from "../ports/types.js";
import type { Seq } from "../session/ids.js";
import { readSealedBatch } from "./privileged-batch.js";
import type { PrivilegedBatch } from "./privileged-batch.js";

/**
 * Open a `PrivilegedBatch` and return its transaction. Importable only from
 * `packages/core/src/visibility/**` and `packages/core/src/replay/**`
 * (dependency rule `core-privileged-batch-opener`); never re-exported.
 * Throws on a value that `sealBatch` did not create.
 */
export function openBatch(batch: PrivilegedBatch): Transaction {
  const tx = readSealedBatch(batch);
  if (tx === undefined) {
    throw new TypeError("openBatch: not a sealed PrivilegedBatch");
  }
  return tx;
}

/** The `seq` the batch commits at, or `null` for an empty accepted batch. */
export function batchSeq(batch: PrivilegedBatch): Seq | null {
  return openBatch(batch).seq;
}
