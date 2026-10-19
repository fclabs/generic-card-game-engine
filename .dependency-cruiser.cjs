/**
 * dependency-cruiser rules for Phase 0 layering (spec §7.3 / BR-001).
 *
 * Matching strategy (N6): each workspace-package edge matches either the
 * resolved filesystem path under packages/ (or pnpm's node_modules/@cge/…)
 * or the bare package specifier (@cge/…), so the same rules work on the real
 * tree and on guardrail fixture trees without node_modules links.
 */

/** @param {string} dirName packages/<dirName> */
function pkgPath(dirName) {
  return `(^|/)packages/${dirName}/`;
}

/** @param {string} pkgName @cge/<name> without the scope */
function pkgSpec(pkgName) {
  return `^@cge/${pkgName}($|/)`;
}

/** @param {string} dirName @param {string} [specName] */
function pkg(dirName, specName = dirName) {
  return [
    `${pkgPath(dirName)}`,
    `(^|/)node_modules/@cge/${specName}/`,
    pkgSpec(specName),
  ];
}

const HELPERS = pkg("helpers");
const CONFIG = pkg("config");
const APP = pkg("app");
const SERVER = pkg("server");
const CONFORMANCE = pkg("conformance");

/** Any adapter package (path or @cge/adapter-* specifier). */
const ADAPTERS = [
  "(^|/)packages/adapters/[^/]+/",
  "(^|/)node_modules/@cge/adapter-[^/]+/",
  "^@cge/adapter-[^/]+($|/)",
];

/** Any other workspace package (used by core-imports-nothing). */
const ANY_WORKSPACE_EXCEPT_SELF_CORE = [
  ...HELPERS,
  ...CONFIG,
  ...APP,
  ...SERVER,
  ...CONFORMANCE,
  ...ADAPTERS,
];

/** Adapters may only import core, app, config — this rule catches helpers + conformance. */
const ADAPTERS_DISALLOWED_EXTRA = [...HELPERS, ...CONFORMANCE];

module.exports = {
  forbidden: [
    {
      name: "layer-core-imports-nothing",
      comment: "core may not import any other workspace package (BR-001).",
      severity: "error",
      from: { path: pkgPath("core") },
      to: { path: ANY_WORKSPACE_EXCEPT_SELF_CORE },
    },
    {
      name: "layer-helpers-core-only",
      comment: "helpers may import only core (BR-001).",
      severity: "error",
      from: { path: pkgPath("helpers") },
      to: { path: [...CONFIG, ...APP, ...SERVER, ...CONFORMANCE, ...ADAPTERS] },
    },
    {
      name: "layer-config-core-only",
      comment: "config may import only core (BR-001).",
      severity: "error",
      from: { path: pkgPath("config") },
      to: {
        path: [...HELPERS, ...APP, ...SERVER, ...CONFORMANCE, ...ADAPTERS],
      },
    },
    {
      name: "layer-app-core-only",
      comment: "app may import only core (BR-001).",
      severity: "error",
      from: { path: pkgPath("app") },
      to: {
        path: [...HELPERS, ...CONFIG, ...SERVER, ...CONFORMANCE, ...ADAPTERS],
      },
    },
    {
      name: "layer-adapters-no-server",
      comment: "adapters must not import server (BR-001).",
      severity: "error",
      from: { path: "(^|/)packages/adapters/" },
      to: { path: SERVER },
    },
    {
      name: "layer-adapters-no-adapters",
      comment: "an adapter must not import another adapter (BR-003).",
      severity: "error",
      from: {
        // $2 = adapter directory name (e.g. store-memory)
        path: "(^|/)packages/adapters/([^/]+)/",
      },
      to: {
        path: ADAPTERS,
        // exclude same-adapter relative imports (and self via package name)
        pathNot: [
          "(^|/)packages/adapters/$2/",
          "(^|/)node_modules/@cge/adapter-$2/",
          "^@cge/adapter-$2($|/)",
        ],
      },
    },
    {
      name: "layer-adapters-allowed-only",
      comment:
        "adapters may import only core, app, config — catches helpers and conformance (BR-001).",
      severity: "error",
      from: { path: "(^|/)packages/adapters/" },
      to: { path: ADAPTERS_DISALLOWED_EXTRA },
    },
    {
      name: "layer-server-no-conformance",
      comment: "server must not import conformance (BR-001).",
      severity: "error",
      from: { path: pkgPath("server") },
      to: { path: CONFORMANCE },
    },
    {
      name: "layer-conformance-leaf",
      comment: "nothing under packages/** may import conformance (BR-001).",
      severity: "error",
      from: {
        path: "(^|/)packages/",
        pathNot: pkgPath("conformance"),
      },
      to: { path: CONFORMANCE },
    },
    {
      name: "core-no-node",
      comment:
        "non-test core source must not import Node built-ins (FR-027 / BR-002).",
      severity: "error",
      from: {
        path: pkgPath("core"),
        pathNot: "\\.test\\.(ts|js|mts|cts)$",
      },
      to: {
        dependencyTypes: ["core"],
      },
    },
    {
      name: "no-circular",
      comment: "no import cycles within or across packages (FR-028).",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    {
      name: "no-undeclared-deps",
      comment:
        "imports must be declared in the importing package's package.json (FR-029). " +
        "Covers npm packages not listed in dependencies/devDependencies. " +
        "Workspace @cge/* packages that resolve via another package's node_modules " +
        "but are undeclared in the importer typically surface as npm-no-pkg or " +
        "couldNotResolve; layering rules catch forbidden workspace edges first.",
      severity: "error",
      from: {},
      to: {
        dependencyTypes: ["npm-no-pkg", "npm-unknown"],
      },
    },
  ],
  options: {
    doNotFollow: {
      path: "node_modules",
      dependencyTypes: [
        "npm",
        "npm-dev",
        "npm-optional",
        "npm-peer",
        "npm-bundled",
        "npm-no-pkg",
      ],
    },
    exclude: {
      // N7 / FR-042: fixtures must stay inert. Do NOT exclude packages/**/dist —
      // FR-026 requires relative imports into another package's dist to be caught.
      // Do NOT exclude node_modules here — that would drop edges to resolved npm
      // packages and silence no-undeclared-deps. Use doNotFollow for node_modules.
      path: "tools/guardrails/fixtures|coverage|\\.tsbuildinfo$",
    },
    tsPreCompilationDeps: true,
    tsConfig: {
      fileName: "tsconfig.json",
    },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
      extensions: [".ts", ".tsx", ".d.ts", ".js", ".mjs", ".cjs"],
    },
    reporterOptions: {
      text: {
        highlightFocused: true,
      },
    },
  },
};
