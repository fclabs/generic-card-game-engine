/**
 * FR-043 repository invariants (checks 1–6).
 * Check 7 (README documents scripts / FR-070–071) is deliberately NOT
 * implemented here — Iteration 10 adds it together with the README.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { repoRoot } from "./lint-helpers.js";
import {
  checkDevDependencyVersions,
  checkNodePnpmVersions,
  checkPackageMetadata,
  checkPlaceholderTests,
  checkSkeletonPurity,
  checkWorkspaceDependencies,
} from "./repo-invariants.js";

const tempRoots: string[] = [];

afterEach(() => {
  for (const dir of tempRoots.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function mkTempRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cge-invariants-"));
  tempRoots.push(dir);
  return dir;
}

function writeFile(root: string, rel: string, contents: string): void {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, contents);
}

/** Minimal tree that satisfies checks 1–6 for mutation baselines. */
function seedMinimalValidRepo(root: string): void {
  writeFile(
    root,
    "pnpm-workspace.yaml",
    `packages:\n  - "packages/*"\n  - "packages/adapters/*"\n  - "tools/*"\n`,
  );
  writeFile(root, ".nvmrc", "22.23.3\n");
  writeFile(
    root,
    "package.json",
    JSON.stringify(
      {
        name: "generic-card-game-engine",
        private: true,
        type: "module",
        packageManager: "pnpm@10.15.1",
        engines: { node: ">=22 <23" },
        devDependencies: { vitest: "5.0.5", typescript: "6.0.3" },
      },
      null,
      2,
    ) + "\n",
  );
  writeFile(
    root,
    "deploy/Dockerfile",
    [
      "FROM node:22.23.3-alpine3.24 AS base",
      "FROM base AS build",
      "FROM build AS test",
      "FROM node:22.23.3-alpine3.24 AS runtime",
      "",
    ].join("\n"),
  );

  const member = (
    relDir: string,
    name: string,
    extras: Record<string, unknown> = {},
  ): void => {
    writeFile(
      root,
      `${relDir}/package.json`,
      JSON.stringify(
        {
          name,
          version: "0.0.0",
          private: true,
          type: "module",
          engines: { node: ">=22 <23" },
          devDependencies: { vitest: "5.0.5" },
          ...extras,
        },
        null,
        2,
      ) + "\n",
    );
    writeFile(root, `${relDir}/src/index.ts`, "export {};\n");
    writeFile(
      root,
      `${relDir}/src/index.test.ts`,
      `import { it, expect } from "vitest";\nit("loads", () => expect(true).toBe(true));\n`,
    );
  };

  member("packages/core", "@cge/core", {
    dependencies: {},
    devDependencies: { vitest: "5.0.5", "fast-check": "4.10.2" },
  });
  member("packages/app", "@cge/app", {
    dependencies: { "@cge/core": "workspace:*" },
  });
  // tools/guardrails is a workspace member but exempt from FR-012 (no packages/**).
  writeFile(
    root,
    "tools/guardrails/package.json",
    JSON.stringify(
      {
        name: "@cge/guardrails",
        version: "0.0.0",
        private: true,
        type: "module",
        engines: { node: ">=22 <23" },
        devDependencies: { vitest: "5.0.5", typescript: "6.0.3" },
      },
      null,
      2,
    ) + "\n",
  );
}

describe("FR-043 check 1 — package metadata (FR-002)", () => {
  it("passes on the real workspace skeleton", () => {
    const result = checkPackageMetadata(repoRoot);
    expect(result).toEqual({ ok: true });
  });

  it("fails naming the package when type is commonjs (VC-002)", () => {
    const root = mkTempRepo();
    seedMinimalValidRepo(root);
    const pkgPath = path.join(root, "packages/core/package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
      type: string;
    };
    pkg.type = "commonjs";
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

    const result = checkPackageMetadata(root);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.message).toContain("packages/core/package.json");
    expect(result.message).toMatch(/type must be "module"/);
    expect(result.message).toContain("commonjs");
  });
});

describe("FR-043 check 2 — Node/pnpm/Dockerfile pins (FR-009/FR-050)", () => {
  it("passes on the real workspace skeleton", () => {
    const result = checkNodePnpmVersions(repoRoot);
    expect(result).toEqual({ ok: true });
  });

  it("fails naming .nvmrc when it disagrees (VC-006)", () => {
    const root = mkTempRepo();
    seedMinimalValidRepo(root);
    fs.writeFileSync(path.join(root, ".nvmrc"), "22.11.0\n");

    const result = checkNodePnpmVersions(root);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.message).toMatch(/\.nvmrc|deploy\/Dockerfile/);
    expect(result.message).toMatch(/22\.11\.0|22\.23\.3/);
  });

  it("fails naming Dockerfile when FROM is floating node:22-alpine (VC-050)", () => {
    const root = mkTempRepo();
    seedMinimalValidRepo(root);
    writeFile(
      root,
      "deploy/Dockerfile",
      [
        "FROM node:22-alpine AS base",
        "FROM base AS build",
        "FROM build AS test",
        "FROM node:22.23.3-alpine3.24 AS runtime",
        "",
      ].join("\n"),
    );

    const result = checkNodePnpmVersions(root);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.message).toContain("deploy/Dockerfile");
    expect(result.message).toContain("node:22-alpine");
  });
});

describe("FR-043 check 3 — placeholder tests (FR-012)", () => {
  it("passes on the real workspace skeleton", () => {
    const result = checkPlaceholderTests(repoRoot);
    expect(result).toEqual({ ok: true });
  });

  it("fails naming the package when src/index.test.ts is missing (VC-012)", () => {
    const root = mkTempRepo();
    seedMinimalValidRepo(root);
    fs.unlinkSync(path.join(root, "packages/core/src/index.test.ts"));

    const result = checkPlaceholderTests(root);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.message).toContain("packages/core");
    expect(result.message).toContain("src/index.test.ts");
  });
});

describe("FR-043 check 4 — skeleton purity (BR-006)", () => {
  it("passes on the real workspace skeleton", () => {
    const result = checkSkeletonPurity(repoRoot);
    expect(result).toEqual({ ok: true });
  });

  it("fails naming the file when a function declaration is present (VC-074)", () => {
    const root = mkTempRepo();
    seedMinimalValidRepo(root);
    writeFile(
      root,
      "packages/core/src/index.ts",
      "export {};\nfunction f() {}\n",
    );

    const result = checkSkeletonPurity(root);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.message).toContain("packages/core/src/index.ts");
    expect(result.message).toMatch(/FunctionDeclaration|non-skeleton/);
  });
});

describe("FR-043 check 5 — exact devDependency versions (BR-007/FR-029)", () => {
  it("passes on the real workspace skeleton", () => {
    const result = checkDevDependencyVersions(repoRoot);
    expect(result).toEqual({ ok: true });
  });

  it("fails naming the package when a caret range is used (VC-075)", () => {
    const root = mkTempRepo();
    seedMinimalValidRepo(root);
    const pkgPath = path.join(root, "packages/app/package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
      devDependencies: Record<string, string>;
    };
    pkg.devDependencies.vitest = "^1.0.0";
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

    const result = checkDevDependencyVersions(root);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.message).toContain("packages/app/package.json");
    expect(result.message).toContain("vitest");
    expect(result.message).toContain("^1.0.0");
  });

  it("fails naming offenders when vitest versions differ", () => {
    const root = mkTempRepo();
    seedMinimalValidRepo(root);
    const pkgPath = path.join(root, "packages/app/package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
      devDependencies: Record<string, string>;
    };
    pkg.devDependencies.vitest = "5.0.4";
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

    const result = checkDevDependencyVersions(root);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.message).toContain("vitest versions differ");
    expect(result.message).toContain("packages/app/package.json");
  });
});

describe("FR-043 check 6 — workspace-only dependencies (BR-009)", () => {
  it("passes on the real workspace skeleton", () => {
    const result = checkWorkspaceDependencies(repoRoot);
    expect(result).toEqual({ ok: true });
  });

  it("fails naming the package when zod is added to dependencies (VC-077)", () => {
    const root = mkTempRepo();
    seedMinimalValidRepo(root);
    const pkgPath = path.join(root, "packages/app/package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
      dependencies: Record<string, string>;
    };
    pkg.dependencies = { ...pkg.dependencies, zod: "3.0.0" };
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

    const result = checkWorkspaceDependencies(root);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.message).toContain("packages/app/package.json");
    expect(result.message).toContain("zod");
  });
});
