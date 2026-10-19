import { describe, it, expect } from "vitest";
import { lintCases } from "./fixtures/lint/cases.js";
import {
  calculatedConfigFor,
  createDeterminismLinter,
  createRepoLinter,
  relativeVirtualPath,
} from "./lint-helpers.js";

const GLOBALS_RULE = "cge/no-nondeterministic-globals";
const IMPORTS_RULE = "cge/no-nondeterministic-imports";

describe("determinism lint fixtures (FR-040 / VC-022–VC-026)", () => {
  const linter = createDeterminismLinter();

  it.each(lintCases.map((c) => [c.id, c] as const))(
    "%s",
    async (_id, lintCase) => {
      const results = await linter.lintText(lintCase.code, {
        filePath: relativeVirtualPath(lintCase.filePath),
      });
      const messages = results[0]?.messages ?? [];
      const cgeMessages = messages.filter(
        (m) => m.ruleId === GLOBALS_RULE || m.ruleId === IMPORTS_RULE,
      );

      if (lintCase.expect === null) {
        expect(
          cgeMessages,
          `expected 0 cge/* errors for ${lintCase.id}, got ${JSON.stringify(cgeMessages)}`,
        ).toEqual([]);
        return;
      }

      const match = cgeMessages.find(
        (m) =>
          m.ruleId === lintCase.expect!.ruleId &&
          (m.message ?? "").includes(lintCase.expect!.name),
      );
      expect(
        match,
        `expected ${lintCase.expect.ruleId} naming '${lintCase.expect.name}' in ${lintCase.id}; messages=${JSON.stringify(cgeMessages)}`,
      ).toBeDefined();
    },
  );

  it("fixture table covers ≥15 banned globals, import forms, and ≥5 allowed (VC-040)", () => {
    const bannedGlobalIds = new Set(
      lintCases
        .filter((c) => c.expect?.ruleId === GLOBALS_RULE)
        .map((c) => c.id.replace(/^ban-global-/, "").replace(/-core$/, ""))
        .filter((id) => id.endsWith("-core") === false)
        .map((id) => id.replace(/-(helpers|hooks)$/, "")),
    );
    // Count distinct global forms exercised at core path.
    const coreGlobalForms = lintCases.filter(
      (c) =>
        c.expect?.ruleId === GLOBALS_RULE &&
        c.filePath === "packages/core/src/x.ts",
    );
    expect(coreGlobalForms.length).toBeGreaterThanOrEqual(15);

    const coreImportForms = lintCases.filter(
      (c) =>
        c.expect?.ruleId === IMPORTS_RULE &&
        c.filePath === "packages/core/src/x.ts",
    );
    const hasStatic = coreImportForms.some((c) => c.id.includes("static-"));
    const hasDynamic = coreImportForms.some((c) => c.id.includes("dynamic-"));
    const hasReexport = coreImportForms.some((c) => c.id.includes("reexport-"));
    expect(hasStatic).toBe(true);
    expect(hasDynamic).toBe(true);
    expect(hasReexport).toBe(true);
    expect(coreImportForms.length).toBeGreaterThanOrEqual(3);

    const allowed = lintCases.filter((c) => c.expect === null);
    // Exclude test-exemption flood; count named allow-* cases.
    const namedAllowed = allowed.filter((c) => c.id.startsWith("allow-"));
    expect(namedAllowed.length).toBeGreaterThanOrEqual(5);

    void bannedGlobalIds;
  });
});

describe("determinism config wiring (N3 / VC-040)", () => {
  const repoLinter = createRepoLinter();

  const inScope = [
    "packages/core/src/x.ts",
    "packages/helpers/src/x.ts",
    "games/demo/hooks/x.ts",
  ];
  const outOfScope = [
    "packages/server/src/x.ts",
    "packages/core/src/x.test.ts",
    "vitest.config.ts",
  ];

  it.each(inScope)(
    "enables both cge/* rules as error for %s",
    async (virtualPath) => {
      const config = await calculatedConfigFor(repoLinter, virtualPath);
      expect(config.rules?.[GLOBALS_RULE]).toEqual([2]);
      expect(config.rules?.[IMPORTS_RULE]).toEqual([2]);
    },
  );

  it.each(outOfScope)(
    "does not enable cge/* rules for %s",
    async (virtualPath) => {
      const config = await calculatedConfigFor(repoLinter, virtualPath);
      const globalsRule = config.rules?.[GLOBALS_RULE];
      const importsRule = config.rules?.[IMPORTS_RULE];
      // Absent, off (0), or explicitly "off".
      const isOff = (v: unknown): boolean =>
        v === undefined ||
        v === 0 ||
        v === "off" ||
        (Array.isArray(v) && (v[0] === 0 || v[0] === "off"));
      expect(isOff(globalsRule)).toBe(true);
      expect(isOff(importsRule)).toBe(true);
    },
  );
});

/** Named suites that map 1:1 to verification criteria (cite in iteration record). */
describe("VC-022 banned globals in packages/core/src/x.ts", () => {
  const linter = createDeterminismLinter();
  const cases = lintCases.filter(
    (c) =>
      c.expect?.ruleId === GLOBALS_RULE &&
      c.filePath === "packages/core/src/x.ts",
  );

  it("reports every VC-022 global with cge/no-nondeterministic-globals", async () => {
    expect(cases.length).toBeGreaterThanOrEqual(15);
    for (const lintCase of cases) {
      const results = await linter.lintText(lintCase.code, {
        filePath: relativeVirtualPath(lintCase.filePath),
      });
      const hit = (results[0]?.messages ?? []).some(
        (m) =>
          m.ruleId === GLOBALS_RULE &&
          (m.message ?? "").includes(lintCase.expect!.name),
      );
      expect(hit, lintCase.id).toBe(true);
    }
  });
});

describe("VC-023 scope and test exemption", () => {
  const linter = createDeterminismLinter();

  it("rejects banned globals in helpers and games hooks", async () => {
    const scoped = lintCases.filter(
      (c) =>
        c.expect?.ruleId === GLOBALS_RULE &&
        (c.filePath === "packages/helpers/src/x.ts" ||
          c.filePath === "games/demo/hooks/x.ts"),
    );
    expect(scoped.length).toBeGreaterThan(0);
    for (const lintCase of scoped) {
      const results = await linter.lintText(lintCase.code, {
        filePath: relativeVirtualPath(lintCase.filePath),
      });
      const hit = (results[0]?.messages ?? []).some(
        (m) => m.ruleId === GLOBALS_RULE,
      );
      expect(hit, lintCase.id).toBe(true);
    }
  });

  it("allows banned forms in packages/core/src/x.test.ts", async () => {
    const exempt = lintCases.filter(
      (c) =>
        c.filePath === "packages/core/src/x.test.ts" &&
        c.id.startsWith("exempt-test-"),
    );
    expect(exempt.length).toBeGreaterThan(0);
    for (const lintCase of exempt) {
      const results = await linter.lintText(lintCase.code, {
        filePath: relativeVirtualPath(lintCase.filePath),
      });
      const cge = (results[0]?.messages ?? []).filter(
        (m) => m.ruleId === GLOBALS_RULE || m.ruleId === IMPORTS_RULE,
      );
      expect(cge, lintCase.id).toEqual([]);
    }
  });
});

describe("VC-024 banned imports in packages/core/src/x.ts", () => {
  const linter = createDeterminismLinter();
  const cases = lintCases.filter(
    (c) =>
      c.expect?.ruleId === IMPORTS_RULE &&
      c.filePath === "packages/core/src/x.ts",
  );

  it("reports static, dynamic, and re-export Node builtin imports", async () => {
    expect(cases.some((c) => c.id.includes("static-"))).toBe(true);
    expect(cases.some((c) => c.id.includes("dynamic-"))).toBe(true);
    expect(cases.some((c) => c.id.includes("reexport-"))).toBe(true);
    for (const lintCase of cases) {
      const results = await linter.lintText(lintCase.code, {
        filePath: relativeVirtualPath(lintCase.filePath),
      });
      const hit = (results[0]?.messages ?? []).some(
        (m) =>
          m.ruleId === IMPORTS_RULE &&
          (m.message ?? "").includes(lintCase.expect!.name),
      );
      expect(hit, lintCase.id).toBe(true);
    }
  });
});

describe("VC-025 out-of-scope allowed", () => {
  const linter = createDeterminismLinter();
  const cases = lintCases.filter((c) =>
    [
      "allow-server",
      "allow-adapter-store-sqlite",
      "allow-config",
      "allow-vitest-config",
      "allow-core-test-file",
    ].includes(c.id),
  );

  it("allows Date.now and node:fs outside determinism scope", async () => {
    expect(cases.length).toBe(5);
    for (const lintCase of cases) {
      const results = await linter.lintText(lintCase.code, {
        filePath: relativeVirtualPath(lintCase.filePath),
      });
      const cge = (results[0]?.messages ?? []).filter(
        (m) => m.ruleId === GLOBALS_RULE || m.ruleId === IMPORTS_RULE,
      );
      expect(cge, lintCase.id).toEqual([]);
    }
  });
});

describe("VC-026 promises allowed (BR-005)", () => {
  const linter = createDeterminismLinter();

  it("allows await Promise.resolve in packages/core/src/x.ts", async () => {
    const lintCase = lintCases.find((c) => c.id === "allow-promise-in-core");
    expect(lintCase).toBeDefined();
    const results = await linter.lintText(lintCase!.code, {
      filePath: relativeVirtualPath(lintCase!.filePath),
    });
    const cge = (results[0]?.messages ?? []).filter(
      (m) => m.ruleId === GLOBALS_RULE || m.ruleId === IMPORTS_RULE,
    );
    expect(cge).toEqual([]);
  });
});
