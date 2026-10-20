import { describe, expect, it } from "vitest";
import { compileDefinition } from "./compile.js";
import type { HookBundleInfo } from "./references.js";
import { collectHookReferences, definitionNeedsBundle } from "./references.js";
import { codePaths, doc, failure, success } from "./compile.testing.js";

const bundle = (...exports: string[]): HookBundleInfo => ({
  hash: "h",
  exports,
});
const compileWith = (raw: unknown, b?: HookBundleInfo) =>
  compileDefinition(raw, b === undefined ? {} : { bundle: b });
const failWith = (raw: unknown, b?: HookBundleInfo) => {
  const r = compileWith(raw, b);
  if (r.ok) throw new Error("expected failure");
  return r.errors;
};
const hooksDoc = (
  hooks: Record<string, unknown>,
  extra: Record<string, unknown> = {},
) => doc({ hooks, ...extra });

describe("VC-223 hooks", () => {
  const hooks = {
    module: "./hooks.ts",
    validation: { play_card: "v1" },
    reaction: { "phase:play": ["a", "b"], "trigger:setup": "s" },
    gate_resolve: { "hearts.pass": ["g"] },
    authorization: "auth",
  };
  const control = { phases: ["deal", "play"], initial_phase: "deal" };

  it("normalises, keeps list order and omits hooks.module", () => {
    const r = compileWith(
      doc({ hooks, control }),
      bundle("v1", "a", "b", "s", "g", "auth"),
    );
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    expect(r.value.hookBindings).toEqual({
      "validation:play_card": ["v1"],
      "reaction:phase:play": ["a", "b"],
      "reaction:trigger:setup": ["s"],
      "gate_resolve:hearts.pass": ["g"],
      "authorization:default": ["auth"],
    });
    expect(Object.keys(r.value)).not.toContain("module");
  });

  it("accepts an empty hooks block and kind: reaction keys", () => {
    expect(success(doc({ hooks: {} })).hookBindings).toEqual({});
  });

  it.each([
    [
      "reaction key foo:bar",
      { reaction: { "foo:bar": "x" } },
      "INVALID_VALUE",
      "hooks.reaction.foo:bar",
    ],
    [
      "undeclared phase",
      { reaction: { "phase:nope": "x" } },
      "UNKNOWN_REFERENCE",
      "hooks.reaction.phase:nope",
    ],
    ["module ../x.ts", { module: "../x.ts" }, "INVALID_VALUE", "hooks.module"],
    [
      "module without ./",
      { module: "hooks.ts" },
      "INVALID_VALUE",
      "hooks.module",
    ],
    ["module .mjs", { module: "./hooks.mjs" }, "INVALID_VALUE", "hooks.module"],
    [
      "module with .. segment",
      { module: "./a/../b.ts" },
      "INVALID_VALUE",
      "hooks.module",
    ],
    [
      "empty list",
      { authorization: [] },
      "INVALID_VALUE",
      "hooks.authorization",
    ],
    [
      "bad export name",
      { validation: { k: "a b" } },
      "INVALID_VALUE",
      "hooks.validation.k",
    ],
    [
      "unknown hook key",
      { postaction: "x" },
      "SCHEMA_UNKNOWN_KEY",
      "hooks.postaction",
    ],
  ])("rejects %s", (_n, h, code, path) => {
    const errors = failWith(hooksDoc(h), bundle("x", "a b"));
    expect(errors.find((e) => e.code === code)).toMatchObject({ path });
  });

  it("accepts phase: for the default main phase", () => {
    const r = compileWith(
      hooksDoc({ module: "./h.js", reaction: { "phase:main": "m" } }),
      bundle("m"),
    );
    expect(r.ok).toBe(true);
  });
});

describe("VC-224 bundle checks", () => {
  const reducers = (extra: Record<string, unknown> = {}) =>
    doc({ meta_schemas: [{ id: "g.s", reducer: "red" }], ...extra });

  it("UNKNOWN_HOOK_EXPORT names the missing export", () => {
    const e = failWith(
      reducers({ hooks: { module: "./h.ts" } }),
      bundle("other"),
    );
    expect(e).toEqual([
      {
        code: "UNKNOWN_HOOK_EXPORT",
        path: "meta_schemas[0].reducer",
        detail: expect.stringContaining("red") as unknown,
        entity: "red",
      },
    ]);
  });

  it("BUNDLE_MISSING when a reference or module exists without a bundle", () => {
    expect(
      codePaths(failWith(reducers({ hooks: { module: "./h.ts" } }))),
    ).toEqual([["BUNDLE_MISSING", "hooks.module"]]);
    expect(codePaths(failWith(hooksDoc({ module: "./h.ts" })))).toEqual([
      ["BUNDLE_MISSING", "hooks.module"],
    ]);
  });

  it("MISSING_HOOK_MODULE for a reducer without hooks.module", () => {
    expect(codePaths(failWith(reducers(), bundle("red")))).toEqual([
      ["MISSING_HOOK_MODULE", "meta_schemas[0].reducer"],
    ]);
    expect(codePaths(failWith(reducers()))).toEqual([
      ["MISSING_HOOK_MODULE", "meta_schemas[0].reducer"],
      ["BUNDLE_MISSING", "meta_schemas[0].reducer"],
    ]);
  });

  it("a definition with no references and no module needs no bundle", () => {
    expect(success(doc({ hooks: {} })).hookBindings).toEqual({});
    expect(compileWith(doc(), bundle()).ok).toBe(true);
  });

  it("checks the roster reducer and every hook list entry", () => {
    const e = failWith(
      doc({
        roster_reducer: "rr",
        hooks: { module: "./h.ts", authorization: ["x", "y"] },
      }),
      bundle("x"),
    );
    expect(codePaths(e)).toEqual([
      ["UNKNOWN_HOOK_EXPORT", "roster_reducer"],
      ["UNKNOWN_HOOK_EXPORT", "hooks.authorization[1]"],
    ]);
  });
});

describe("VC-225 policies", () => {
  it("defaults", () => {
    expect(success(doc()).policies).toEqual({
      cascadeCap: 16,
      costBudgets: {},
    });
    expect(success(doc({ policies: {} })).policies).toEqual({
      cascadeCap: 16,
      costBudgets: {},
    });
  });

  it("validates cascade_cap range and ceiling", () => {
    expect(codePaths(failure(doc({ policies: { cascade_cap: 0 } })))).toEqual([
      ["INVALID_VALUE", "policies.cascade_cap"],
    ]);
    expect(codePaths(failure(doc({ policies: { cascade_cap: 257 } })))).toEqual(
      [["INVALID_VALUE", "policies.cascade_cap"]],
    );
    expect(
      success(doc({ policies: { cascade_cap: 256 } })).policies.cascadeCap,
    ).toBe(256);
    const r = compileDefinition(doc({ policies: { cascade_cap: 100 } }), {
      limits: { cascadeCapMax: 50 },
    });
    expect(r.ok ? [] : codePaths(r.errors)).toEqual([
      ["LIMIT_EXCEEDED", "policies.cascade_cap"],
    ]);
    expect(
      compileDefinition(doc({ policies: { cascade_cap: 50 } }), {
        limits: { cascadeCapMax: 50 },
      }).ok,
    ).toBe(true);
  });

  it("validates cost budgets", () => {
    expect(
      success(
        doc({
          policies: { cost_budgets: { validation: 5, authorization: 7 } },
        }),
      ).policies.costBudgets,
    ).toEqual({ validation: 5, authorization: 7 });
    expect(
      codePaths(failure(doc({ policies: { cost_budgets: { render: 1 } } }))),
    ).toEqual([["SCHEMA_UNKNOWN_KEY", "policies.cost_budgets.render"]]);
    expect(
      codePaths(failure(doc({ policies: { cost_budgets: { reaction: 0 } } }))),
    ).toEqual([["INVALID_VALUE", "policies.cost_budgets.reaction"]]);
    const r = compileDefinition(
      doc({ policies: { cost_budgets: { reaction: 11 } } }),
      {
        limits: { cascadeCapMax: 256, costBudgetMax: 10 },
      },
    );
    expect(r.ok ? [] : codePaths(r.errors)).toEqual([
      ["LIMIT_EXCEEDED", "policies.cost_budgets.reaction"],
    ]);
  });
});

describe("VC-237 definitionNeedsBundle (unit part)", () => {
  it.each([
    ["hooks.module only", doc({ hooks: { module: "./h.ts" } }), true],
    [
      "reducer reference only",
      doc({ meta_schemas: [{ id: "a", reducer: "r" }] }),
      true,
    ],
    ["roster_reducer only", doc({ roster_reducer: "r" }), true],
    ["hook binding only", doc({ hooks: { authorization: "a" } }), true],
    [
      "reaction binding only",
      doc({ hooks: { reaction: { "kind:x": ["a"] } } }),
      true,
    ],
    ["none", doc(), false],
    ["empty hooks", doc({ hooks: {} }), false],
    ["schema without reducer", doc({ meta_schemas: [{ id: "a" }] }), false],
    ["non-object", 42, false],
    ["null", null, false],
  ])("%s -> %s", (_n, raw, expected) => {
    expect(definitionNeedsBundle(raw)).toBe(expected);
  });

  it("collectHookReferences is sorted and distinct", () => {
    expect(
      collectHookReferences(
        doc({
          meta_schemas: [{ id: "a", reducer: "zeta" }],
          roster_reducer: "alpha",
          hooks: { validation: { k: ["zeta", "mid"] }, authorization: "alpha" },
        }),
      ),
    ).toEqual(["alpha", "mid", "zeta"]);
    expect(collectHookReferences(undefined)).toEqual([]);
  });
});
