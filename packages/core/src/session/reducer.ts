import type { Snapshot } from "./snapshot.js";

/**
 * A pure, synchronous partition reducer (spec KFR-090): it receives the deep-readonly
 * partition it owns (`roster`, or `meta[schema_id]`) and the action payload, and returns the
 * new partition. `apply` validates the result (KFR-050). The SPI re-exports this type.
 */
export type Reducer<S> = (partition: Snapshot<S>, payload: unknown) => S;
