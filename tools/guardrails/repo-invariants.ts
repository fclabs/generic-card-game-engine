/**
 * FR-043 repository invariant checks 1–7 as pure functions over a repo root.
 * Check 7 reads docs/dev-setup.md (linked from README.md).
 */
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

export type CheckResult = { ok: true } | { ok: false; message: string };

const ENGINES_NODE = ">=22 <23";
const EXACT_VERSION = /^\d+\.\d+\.\d+$/;
const PINNED_NODE_IMAGE =
  /^node:22\.\d+\.\d+-alpine\d+\.\d+(?:@sha256:[a-f0-9]+)?$/;
const FLOATING_NODE_IMAGE = /^node:22(?:-alpine)?(?:@sha256:[a-f0-9]+)?$/;
const WORKSPACE_DEP = /^workspace:/;

type PackageJson = {
  name?: unknown;
  private?: unknown;
  type?: unknown;
  engines?: { node?: unknown };
  packageManager?: unknown;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

function fail(message: string): CheckResult {
  return { ok: false, message };
}

function pass(): CheckResult {
  return { ok: true };
}

function readJson(filePath: string): PackageJson {
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw) as PackageJson;
}

function listDirsWithPackageJson(dir: string): string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => path.join(dir, d.name))
    .filter((p) => fs.existsSync(path.join(p, "package.json")));
}

/** Discover workspace member absolute paths from pnpm-workspace.yaml globs. */
export function discoverWorkspaceMembers(repoRoot: string): string[] {
  const wsPath = path.join(repoRoot, "pnpm-workspace.yaml");
  if (!fs.existsSync(wsPath)) {
    throw new Error(`missing pnpm-workspace.yaml at ${wsPath}`);
  }
  // Phase 0 globs are fixed: packages/*, packages/adapters/*, tools/*
  const members = [
    ...listDirsWithPackageJson(path.join(repoRoot, "packages")),
    ...listDirsWithPackageJson(path.join(repoRoot, "packages", "adapters")),
    ...listDirsWithPackageJson(path.join(repoRoot, "tools")),
  ];
  return members.sort();
}

function expectedPackageName(memberAbs: string, repoRoot: string): string {
  const rel = path.relative(repoRoot, memberAbs).split(path.sep).join("/");
  if (rel.startsWith("packages/adapters/")) {
    const dir = rel.slice("packages/adapters/".length);
    return `@cge/adapter-${dir}`;
  }
  if (rel.startsWith("packages/")) {
    return `@cge/${rel.slice("packages/".length)}`;
  }
  if (rel.startsWith("tools/")) {
    return `@cge/${rel.slice("tools/".length)}`;
  }
  throw new Error(`unexpected workspace member path: ${rel}`);
}

/** FR-043 check 1 / FR-002 — package metadata. */
export function checkPackageMetadata(repoRoot: string): CheckResult {
  const rootPkgPath = path.join(repoRoot, "package.json");
  if (!fs.existsSync(rootPkgPath)) {
    return fail(`missing root package.json at ${rootPkgPath}`);
  }
  const rootPkg = readJson(rootPkgPath);
  if (rootPkg.private !== true) {
    return fail(`root package.json: private must be true`);
  }
  if (
    typeof rootPkg.packageManager !== "string" ||
    rootPkg.packageManager.length === 0
  ) {
    return fail(`root package.json: missing packageManager`);
  }

  for (const memberAbs of discoverWorkspaceMembers(repoRoot)) {
    const pkgPath = path.join(memberAbs, "package.json");
    const pkg = readJson(pkgPath);
    const expected = expectedPackageName(memberAbs, repoRoot);
    const rel = path.relative(repoRoot, pkgPath);

    if (pkg.name !== expected) {
      return fail(
        `${rel}: name must be ${JSON.stringify(expected)}, got ${JSON.stringify(pkg.name)}`,
      );
    }
    if (pkg.type !== "module") {
      return fail(
        `${rel}: type must be "module", got ${JSON.stringify(pkg.type)}`,
      );
    }
    if (pkg.private !== true) {
      return fail(`${rel}: private must be true`);
    }
    if (pkg.engines?.node !== ENGINES_NODE) {
      return fail(
        `${rel}: engines.node must be ${JSON.stringify(ENGINES_NODE)}, got ${JSON.stringify(pkg.engines?.node)}`,
      );
    }
  }
  return pass();
}

type FromLine = {
  image: string;
  stage: string | undefined;
  line: number;
  raw: string;
};

function parseDockerfileFroms(dockerfile: string): FromLine[] {
  const lines = dockerfile.split(/\r?\n/);
  const result: FromLine[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i]?.trim() ?? "";
    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      continue;
    }
    const match = /^FROM\s+(\S+)(?:\s+[Aa][Ss]\s+(\S+))?/.exec(trimmed);
    if (match) {
      result.push({
        image: match[1] ?? "",
        stage: match[2],
        line: i + 1,
        raw: trimmed,
      });
    }
  }
  return result;
}

/** FR-043 check 2 / FR-009 / FR-050 — Node/pnpm/Dockerfile pin agreement. */
export function checkNodePnpmVersions(repoRoot: string): CheckResult {
  const nvmrcPath = path.join(repoRoot, ".nvmrc");
  const rootPkgPath = path.join(repoRoot, "package.json");
  const dockerfilePath = path.join(repoRoot, "deploy", "Dockerfile");

  if (!fs.existsSync(nvmrcPath)) {
    return fail(`missing .nvmrc`);
  }
  const nvmrc = fs.readFileSync(nvmrcPath, "utf8").trim();
  if (!EXACT_VERSION.test(nvmrc) || !nvmrc.startsWith("22.")) {
    return fail(
      `.nvmrc: expected exact Node 22.x.y, got ${JSON.stringify(nvmrc)}`,
    );
  }

  if (!fs.existsSync(rootPkgPath)) {
    return fail(`missing root package.json`);
  }
  const rootPkg = readJson(rootPkgPath);
  if (rootPkg.engines?.node !== ENGINES_NODE) {
    return fail(
      `package.json: engines.node must be ${JSON.stringify(ENGINES_NODE)}, got ${JSON.stringify(rootPkg.engines?.node)}`,
    );
  }
  if (typeof rootPkg.packageManager !== "string") {
    return fail(`package.json: missing packageManager`);
  }
  const pmMatch = /^pnpm@(\d+\.\d+\.\d+)$/.exec(rootPkg.packageManager);
  if (!pmMatch) {
    return fail(
      `package.json: packageManager must be pnpm@X.Y.Z, got ${JSON.stringify(rootPkg.packageManager)}`,
    );
  }

  if (!fs.existsSync(dockerfilePath)) {
    return fail(`missing deploy/Dockerfile`);
  }
  const dockerfile = fs.readFileSync(dockerfilePath, "utf8");
  const froms = parseDockerfileFroms(dockerfile);
  const base = froms.find((f) => f.stage === "base");
  const runtime = froms.find((f) => f.stage === "runtime");
  if (!base) {
    return fail(`deploy/Dockerfile: missing FROM … AS base`);
  }
  if (!runtime) {
    return fail(`deploy/Dockerfile: missing FROM … AS runtime`);
  }

  for (const stage of [base, runtime]) {
    if (
      FLOATING_NODE_IMAGE.test(stage.image) &&
      !PINNED_NODE_IMAGE.test(stage.image)
    ) {
      return fail(
        `deploy/Dockerfile:${stage.line}: floating/unpinned base image ${JSON.stringify(stage.image)} (stage ${stage.stage})`,
      );
    }
    if (!PINNED_NODE_IMAGE.test(stage.image)) {
      return fail(
        `deploy/Dockerfile:${stage.line}: stage ${stage.stage} image must match node:22.x.y-alpineM.m, got ${JSON.stringify(stage.image)}`,
      );
    }
    const nodeFromImage = /^node:(22\.\d+\.\d+)/.exec(stage.image)?.[1];
    if (nodeFromImage !== nvmrc) {
      return fail(
        `deploy/Dockerfile:${stage.line}: stage ${stage.stage} Node ${JSON.stringify(nodeFromImage)} disagrees with .nvmrc ${JSON.stringify(nvmrc)}`,
      );
    }
  }

  if (base.image !== runtime.image) {
    return fail(
      `deploy/Dockerfile: base image ${JSON.stringify(base.image)} disagrees with runtime image ${JSON.stringify(runtime.image)}`,
    );
  }

  return pass();
}

/** Packages under packages/ (top-level + adapters), absolute paths. */
export function discoverPackagesPackages(repoRoot: string): string[] {
  return [
    ...listDirsWithPackageJson(path.join(repoRoot, "packages")),
    ...listDirsWithPackageJson(path.join(repoRoot, "packages", "adapters")),
  ].sort();
}

/** FR-043 check 3 / FR-012 — every packages/ member has src/index.test.ts. */
export function checkPlaceholderTests(repoRoot: string): CheckResult {
  for (const pkgAbs of discoverPackagesPackages(repoRoot)) {
    const testPath = path.join(pkgAbs, "src", "index.test.ts");
    if (!fs.existsSync(testPath)) {
      const rel = path.relative(repoRoot, pkgAbs);
      return fail(`${rel}: missing src/index.test.ts`);
    }
  }
  return pass();
}

function collectNonTestTsFiles(dir: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) {
    return out;
  }
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectNonTestTsFiles(full));
    } else if (
      entry.isFile() &&
      entry.name.endsWith(".ts") &&
      !entry.name.endsWith(".test.ts")
    ) {
      out.push(full);
    }
  }
  return out;
}

function isAllowedSkeletonStatement(stmt: ts.Statement): boolean {
  // Only ExportDeclaration that is `export {}` or a re-export (`from "…"`).
  if (!ts.isExportDeclaration(stmt)) {
    return false;
  }
  if (stmt.moduleSpecifier !== undefined) {
    // export … from "…" / export * from "…"
    return true;
  }
  // export {} (empty named exports, no from)
  if (
    stmt.exportClause !== undefined &&
    ts.isNamedExports(stmt.exportClause) &&
    stmt.exportClause.elements.length === 0
  ) {
    return true;
  }
  return false;
}

/**
 * FR-043 check 4 / BR-006 — non-test package sources are skeleton-only.
 * Phase 1 exempts `packages/core` only (spec 01-phase-1 §6.5).
 */
export function checkSkeletonPurity(repoRoot: string): CheckResult {
  const packagesRoot = path.join(repoRoot, "packages");
  const coreRoot = path.join(packagesRoot, "core") + path.sep;
  const files = collectNonTestTsFiles(packagesRoot).filter(
    (f) => !f.startsWith(coreRoot),
  );
  for (const filePath of files) {
    const text = fs.readFileSync(filePath, "utf8");
    const source = ts.createSourceFile(
      filePath,
      text,
      ts.ScriptTarget.ES2022,
      true,
      ts.ScriptKind.TS,
    );
    for (const stmt of source.statements) {
      if (!isAllowedSkeletonStatement(stmt)) {
        const { line } = source.getLineAndCharacterOfPosition(
          stmt.getStart(source),
        );
        const rel = path.relative(repoRoot, filePath);
        const kind = ts.SyntaxKind[stmt.kind] ?? String(stmt.kind);
        return fail(
          `${rel}:${line + 1}: non-skeleton statement (${kind}); Phase 0 allows only export {}, re-exports and comments`,
        );
      }
    }
  }
  return pass();
}

function allPackageJsonPaths(repoRoot: string): string[] {
  const paths = [
    path.join(repoRoot, "package.json"),
    ...discoverWorkspaceMembers(repoRoot).map((m) =>
      path.join(m, "package.json"),
    ),
  ];
  return paths.filter((p) => fs.existsSync(p));
}

/** FR-043 check 5 / BR-007 / FR-029 — exact devDependency versions; single vitest/fast-check. */
export function checkDevDependencyVersions(repoRoot: string): CheckResult {
  const vitestVersions = new Map<string, string[]>();
  const fastCheckVersions = new Map<string, string[]>();

  for (const pkgPath of allPackageJsonPaths(repoRoot)) {
    const pkg = readJson(pkgPath);
    const rel = path.relative(repoRoot, pkgPath);
    const devDeps = pkg.devDependencies ?? {};
    for (const [name, version] of Object.entries(devDeps)) {
      if (!EXACT_VERSION.test(version)) {
        return fail(
          `${rel}: devDependency ${JSON.stringify(name)} version ${JSON.stringify(version)} must match ^\\d+\\.\\d+\\.\\d+$`,
        );
      }
      if (name === "vitest") {
        const list = vitestVersions.get(version) ?? [];
        list.push(rel);
        vitestVersions.set(version, list);
      }
      if (name === "fast-check") {
        const list = fastCheckVersions.get(version) ?? [];
        list.push(rel);
        fastCheckVersions.set(version, list);
      }
    }
  }

  if (vitestVersions.size > 1) {
    const detail = [...vitestVersions.entries()]
      .map(([v, files]) => `${v} in ${files.join(", ")}`)
      .join("; ");
    return fail(`vitest versions differ across the workspace: ${detail}`);
  }
  if (fastCheckVersions.size > 1) {
    const detail = [...fastCheckVersions.entries()]
      .map(([v, files]) => `${v} in ${files.join(", ")}`)
      .join("; ");
    return fail(`fast-check versions differ across the workspace: ${detail}`);
  }
  return pass();
}

/** FR-043 check 6 / BR-009 — dependencies are workspace-protocol @cge/* only. */
export function checkWorkspaceDependencies(repoRoot: string): CheckResult {
  for (const pkgPath of allPackageJsonPaths(repoRoot)) {
    const pkg = readJson(pkgPath);
    const rel = path.relative(repoRoot, pkgPath);
    const deps = pkg.dependencies ?? {};
    for (const [name, version] of Object.entries(deps)) {
      if (!name.startsWith("@cge/")) {
        return fail(
          `${rel}: dependency ${JSON.stringify(name)} is not a workspace @cge/* package (BR-009)`,
        );
      }
      if (!WORKSPACE_DEP.test(version)) {
        return fail(
          `${rel}: dependency ${JSON.stringify(name)} must use workspace: protocol, got ${JSON.stringify(version)}`,
        );
      }
    }
  }
  return pass();
}

/** Root scripts that need not appear in docs/dev-setup.md (none today). */
export const DOCUMENTATION_SCRIPT_ALLOWLIST: readonly string[] = [];

const LAYERING_STRING = "core ← app ← adapters ← server";
const DOCKER_TEST_CMD =
  "docker compose -f deploy/docker-compose.test.yml run --rm tests";
const DOCKER_UP_CMD = "docker compose -f deploy/docker-compose.yml up";
const ADDING_PACKAGE_HEADING = /^#{1,6}\s+Adding a package\s*$/m;

type RootPackageJson = PackageJson & {
  scripts?: Record<string, string>;
};

/**
 * FR-043 check 7 — docs/dev-setup.md (linked from README) documents every root
 * script, both Docker commands, the layering string, and "Adding a package".
 */
export function checkDocumentation(repoRoot: string): CheckResult {
  const readmePath = path.join(repoRoot, "README.md");
  if (!fs.existsSync(readmePath)) {
    return fail(`missing README.md`);
  }
  const readme = fs.readFileSync(readmePath, "utf8");
  if (!readme.includes("docs/dev-setup.md")) {
    return fail(`README.md: must link to docs/dev-setup.md`);
  }

  const docPath = path.join(repoRoot, "docs", "dev-setup.md");
  if (!fs.existsSync(docPath)) {
    return fail(`missing docs/dev-setup.md`);
  }
  const doc = fs.readFileSync(docPath, "utf8");

  const rootPkgPath = path.join(repoRoot, "package.json");
  if (!fs.existsSync(rootPkgPath)) {
    return fail(`missing root package.json`);
  }
  const rootPkg = readJson(rootPkgPath) as RootPackageJson;
  const scripts = Object.keys(rootPkg.scripts ?? {});
  const required = scripts.filter(
    (name) => !DOCUMENTATION_SCRIPT_ALLOWLIST.includes(name),
  );

  for (const name of required) {
    const needle = "`" + name + "`";
    if (!doc.includes(needle)) {
      return fail(
        `docs/dev-setup.md: missing documented script ${JSON.stringify(name)} (expected ${needle})`,
      );
    }
  }

  if (!doc.includes(DOCKER_TEST_CMD)) {
    return fail(
      `docs/dev-setup.md: missing Docker test command ${JSON.stringify(DOCKER_TEST_CMD)}`,
    );
  }
  if (!doc.includes(DOCKER_UP_CMD)) {
    return fail(
      `docs/dev-setup.md: missing Docker up command ${JSON.stringify(DOCKER_UP_CMD)}`,
    );
  }

  if (!doc.includes(LAYERING_STRING)) {
    return fail(
      `docs/dev-setup.md: missing layering string ${JSON.stringify(LAYERING_STRING)}`,
    );
  }

  if (!ADDING_PACKAGE_HEADING.test(doc)) {
    return fail(
      `docs/dev-setup.md: missing markdown heading "Adding a package"`,
    );
  }

  return pass();
}
