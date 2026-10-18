/**
 * Expected violated-rule sets for each fixtures/depcruise/<id> tree (FR-041).
 *
 * Where an extra §7.3 rule legitimately fires on the same edge, the set lists
 * every name (e.g. app→conformance → layer-conformance-leaf + layer-app-core-only).
 */

export type DepcruiseCase = {
  /** Directory name under fixtures/depcruise/ */
  id: string;
  /** Exact set of forbidden rule names expected (empty = clean). */
  expect: readonly string[];
  /** Spec VC this case primarily covers (for suite naming). */
  vc: string;
};

export const depcruiseCases: readonly DepcruiseCase[] = [
  // VC-027
  {
    id: "layer-core-imports-nothing-spec",
    expect: ["layer-core-imports-nothing"],
    vc: "VC-027",
  },
  {
    id: "layer-core-imports-nothing-relative-src",
    expect: ["layer-core-imports-nothing"],
    vc: "VC-027",
  },
  {
    id: "layer-core-imports-nothing-relative-dist",
    expect: ["layer-core-imports-nothing"],
    vc: "VC-027",
  },
  // VC-028
  {
    id: "layer-app-core-only-adapter",
    expect: ["layer-app-core-only"],
    vc: "VC-028",
  },
  {
    id: "layer-app-core-only-config",
    expect: ["layer-app-core-only"],
    vc: "VC-028",
  },
  {
    id: "layer-helpers-core-only",
    expect: ["layer-helpers-core-only"],
    vc: "VC-028",
  },
  {
    id: "layer-config-core-only",
    expect: ["layer-config-core-only"],
    vc: "VC-028",
  },
  // VC-029
  {
    id: "layer-adapters-no-server",
    expect: ["layer-adapters-no-server"],
    vc: "VC-029",
  },
  {
    id: "layer-adapters-no-adapters",
    expect: ["layer-adapters-no-adapters"],
    vc: "VC-029",
  },
  {
    id: "layer-adapters-allowed-only-helpers",
    expect: ["layer-adapters-allowed-only"],
    vc: "VC-029",
  },
  {
    id: "layer-adapters-allowed-only-conformance",
    // also layer-conformance-leaf (nothing under packages/** → conformance)
    expect: ["layer-adapters-allowed-only", "layer-conformance-leaf"],
    vc: "VC-029",
  },
  // VC-030
  {
    id: "layer-server-no-conformance",
    expect: ["layer-server-no-conformance", "layer-conformance-leaf"],
    vc: "VC-030",
  },
  {
    id: "layer-conformance-leaf",
    expect: ["layer-conformance-leaf", "layer-app-core-only"],
    vc: "VC-030",
  },
  // VC-031
  {
    id: "legitimate-directions",
    expect: [],
    vc: "VC-031",
  },
  // VC-032
  {
    id: "core-no-node-node-fs",
    expect: ["core-no-node"],
    vc: "VC-032",
  },
  {
    id: "core-no-node-bare-path",
    expect: ["core-no-node"],
    vc: "VC-032",
  },
  {
    id: "core-no-node-bare-stream",
    expect: ["core-no-node"],
    vc: "VC-032",
  },
  {
    id: "core-no-node-test-exempt",
    expect: [],
    vc: "VC-032",
  },
  // VC-033
  {
    id: "no-circular-intra",
    expect: ["no-circular"],
    vc: "VC-033",
  },
  {
    id: "no-circular-cross",
    // core→app also trips layer-core-imports-nothing (no mutual legal edge exists)
    expect: ["layer-core-imports-nothing", "no-circular"],
    vc: "VC-033",
  },
  {
    id: "no-undeclared-deps",
    expect: ["no-undeclared-deps"],
    vc: "VC-033",
  },
];

/** The 12 named §7.3 dependency-cruiser rules (stable identifiers). */
export const SECTION_73_RULES: readonly string[] = [
  "layer-core-imports-nothing",
  "layer-helpers-core-only",
  "layer-config-core-only",
  "layer-app-core-only",
  "layer-adapters-no-server",
  "layer-adapters-no-adapters",
  "layer-adapters-allowed-only",
  "layer-server-no-conformance",
  "layer-conformance-leaf",
  "core-no-node",
  "no-circular",
  "no-undeclared-deps",
] as const;
