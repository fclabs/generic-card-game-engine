import { describe, it, expect } from "vitest";
import {
  depcruiseCases,
  SECTION_73_RULES,
  type DepcruiseCase,
} from "./depcruise-cases.js";
import { cruiseFixtureCase, sortedRuleNames } from "./depcruise-helpers.js";

function assertExactRules(
  caseId: string,
  actual: Set<string>,
  expected: readonly string[],
): void {
  expect(
    sortedRuleNames(actual),
    `case ${caseId}: unexpected rule set`,
  ).toEqual(sortedRuleNames(expected));
}

describe("depcruise fixtures (FR-041 / VC-027–VC-033 / VC-041)", () => {
  it.each(depcruiseCases.map((c) => [c.id, c] as const))(
    "%s → exact rule set",
    async (_id, cruiseCase: DepcruiseCase) => {
      const { ruleNames } = await cruiseFixtureCase(cruiseCase.id);
      assertExactRules(cruiseCase.id, ruleNames, cruiseCase.expect);
    },
  );

  it("covers all 13 rules (§7.3 plus core-privileged-batch-opener) and VC-031 legitimate-directions (VC-041)", () => {
    const rulesSeen = new Set<string>();
    for (const c of depcruiseCases) {
      for (const r of c.expect) {
        rulesSeen.add(r);
      }
    }
    for (const rule of SECTION_73_RULES) {
      expect(
        rulesSeen.has(rule),
        `missing a fixture that expects rule ${rule}`,
      ).toBe(true);
    }
    expect(
      depcruiseCases.some(
        (c) => c.id === "legitimate-directions" && c.expect.length === 0,
      ),
    ).toBe(true);
  });
});

describe("VC-027 core imports nothing", () => {
  it("specifier and relative-src/dist cases", () => {
    const ids = depcruiseCases
      .filter((c) => c.vc === "VC-027")
      .map((c) => c.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "layer-core-imports-nothing-spec",
        "layer-core-imports-nothing-relative-src",
        "layer-core-imports-nothing-relative-dist",
      ]),
    );
  });
});

describe("VC-028 app/helpers/config core-only", () => {
  it("lists the four violation cases", () => {
    const ids = depcruiseCases
      .filter((c) => c.vc === "VC-028")
      .map((c) => c.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "layer-app-core-only-adapter",
        "layer-app-core-only-config",
        "layer-helpers-core-only",
        "layer-config-core-only",
      ]),
    );
  });
});

describe("VC-029 adapters restrictions", () => {
  it("lists server/peer/helpers/conformance cases", () => {
    const ids = depcruiseCases
      .filter((c) => c.vc === "VC-029")
      .map((c) => c.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "layer-adapters-no-server",
        "layer-adapters-no-adapters",
        "layer-adapters-allowed-only-helpers",
        "layer-adapters-allowed-only-conformance",
      ]),
    );
  });
});

describe("VC-030 conformance leaf", () => {
  it("lists server and app→conformance cases", () => {
    const ids = depcruiseCases
      .filter((c) => c.vc === "VC-030")
      .map((c) => c.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "layer-server-no-conformance",
        "layer-conformance-leaf",
      ]),
    );
  });
});

describe("VC-031 legitimate directions", () => {
  it("legitimate-directions expects empty set", () => {
    const c = depcruiseCases.find((x) => x.id === "legitimate-directions");
    expect(c?.expect).toEqual([]);
  });
});

describe("VC-032 core-no-node", () => {
  it("lists node:/bare/test-exempt cases", () => {
    const ids = depcruiseCases
      .filter((c) => c.vc === "VC-032")
      .map((c) => c.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "core-no-node-node-fs",
        "core-no-node-bare-path",
        "core-no-node-bare-stream",
        "core-no-node-test-exempt",
      ]),
    );
  });
});

describe("VC-033 circular and undeclared", () => {
  it("lists intra/cross circular and undeclared cases", () => {
    const ids = depcruiseCases
      .filter((c) => c.vc === "VC-033")
      .map((c) => c.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "no-circular-intra",
        "no-circular-cross",
        "no-undeclared-deps",
      ]),
    );
  });
});

describe("VC-337 privileged batch opener", () => {
  it("lists the violating and allowed cases and the rule", () => {
    expect(SECTION_73_RULES).toContain("core-privileged-batch-opener");
    const byId = new Map(
      depcruiseCases.filter((c) => c.vc === "VC-337").map((c) => [c.id, c]),
    );
    expect(byId.get("core-privileged-batch-opener-app")?.expect).toEqual([
      "core-privileged-batch-opener",
    ]);
    expect(byId.get("core-privileged-batch-opener-allowed")?.expect).toEqual(
      [],
    );
  });
});
