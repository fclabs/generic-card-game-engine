import type { Transaction } from "../ports/types.js";

declare const batchBrand: unique symbol;

/**
 * An opaque handle on one committed transaction (PFR-030). It is a frozen,
 * empty object: no enumerable key, no symbol, `JSON.stringify` yields `{}`.
 * The payload lives in a module-private `WeakMap`; only `open-batch.ts`
 * (importable from `visibility/**` and `replay/**` alone, rule
 * `core-privileged-batch-opener`) can read it. The brand is type-only.
 */
export interface PrivilegedBatch {
  readonly [batchBrand]: true;
}

const payloads = new WeakMap<object, Transaction>();

/** Seal a transaction into an opaque `PrivilegedBatch`. */
export function sealBatch(tx: Transaction): PrivilegedBatch {
  const handle = Object.freeze(Object.create(null) as object);
  payloads.set(handle, tx);
  return handle as PrivilegedBatch;
}

/**
 * Internal accessor for `open-batch.ts` only. Not re-exported from any index.
 * @internal
 */
export function readSealedBatch(
  batch: PrivilegedBatch,
): Transaction | undefined {
  return payloads.get(batch);
}
