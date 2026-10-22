import { describe, expect, it } from "vitest";
import * as replay from "./index.js";
import * as root from "../index.js";

describe("core/replay exports (Iteration 8)", () => {
  it("exposes the package API and the canonical decoder, re-exported by the root", () => {
    for (const name of [
      "decodeCanonical",
      "encodePackage",
      "decodePackage",
      "buildPackage",
      "replayPackageSchema",
      "replayError",
      "REPLAY_PACKAGE_FORMAT_VERSION",
      "DEFAULT_MAX_PACKAGE_BYTES",
      "canonicalize",
      "stateDigest",
    ] as const) {
      expect(replay[name], name).toBeDefined();
      expect(root[name], name).toBe(replay[name]);
    }
  });

  it("never exports the batch opener", () => {
    for (const mod of [replay, root] as Record<string, unknown>[]) {
      expect("openBatch" in mod).toBe(false);
      expect("batchSeq" in mod).toBe(false);
    }
  });
});
