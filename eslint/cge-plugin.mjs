import { builtinModules } from "node:module";

/** @type {ReadonlySet<string>} */
const BANNED_IDENTIFIERS = new Set([
  "Date",
  "performance",
  "process",
  "setTimeout",
  "setInterval",
  "setImmediate",
  "queueMicrotask",
  "Atomics",
  "SharedArrayBuffer",
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  "crypto",
]);

/** Bare Node built-ins (no `node:` prefix), including subpaths like `fs/promises`. */
const BARE_BUILTINS = new Set(
  builtinModules.filter((name) => !name.startsWith("node:")),
);

/**
 * @param {import('eslint').Scope.Scope} scope
 * @param {string} name
 */
function isShadowed(scope, name) {
  let current = scope;
  while (current) {
    const variable = current.set.get(name);
    if (variable && variable.defs.length > 0) {
      return true;
    }
    current = current.upper;
  }
  return false;
}

/**
 * @param {import('eslint').Rule.RuleContext} context
 * @param {import('estree').Node} node
 * @param {string} name
 */
function isGlobalIdentifier(context, node, name) {
  const scope = context.sourceCode.getScope(node);
  return !isShadowed(scope, name);
}

/**
 * @param {string} specifier
 */
function isNondeterministicSpecifier(specifier) {
  if (specifier.startsWith("node:")) {
    return true;
  }
  if (BARE_BUILTINS.has(specifier)) {
    return true;
  }
  const firstSegment = specifier.split("/")[0] ?? specifier;
  return BARE_BUILTINS.has(firstSegment);
}

/**
 * True when the identifier appears only in a TypeScript type position.
 * @param {import('estree').Node & { parent?: import('estree').Node }} node
 */
function isTypePosition(node) {
  let current = node.parent;
  while (current) {
    const type = current.type;
    if (
      type === "TSTypeReference" ||
      type === "TSTypeQuery" ||
      type === "TSExpressionWithTypeArguments" ||
      type === "TSTypeParameter" ||
      type === "TSQualifiedName" ||
      type === "TSInterfaceHeritage" ||
      type === "TSClassImplements" ||
      type === "TSAsExpression" ||
      type === "TSTypeAnnotation" ||
      type === "TSImportType"
    ) {
      // Value position of `x as Date` still needs to check `x`, not `Date`.
      if (type === "TSAsExpression" && "expression" in current) {
        const asNode = /** @type {{ expression: import('estree').Node }} */ (
          current
        );
        if (asNode.expression === node || isAncestor(asNode.expression, node)) {
          return false;
        }
      }
      return true;
    }
    if (
      type === "Program" ||
      type === "BlockStatement" ||
      type === "FunctionDeclaration" ||
      type === "FunctionExpression" ||
      type === "ArrowFunctionExpression"
    ) {
      break;
    }
    current = /** @type {typeof current} */ (
      /** @type {{ parent?: typeof current }} */ (current).parent
    );
  }
  return false;
}

/**
 * @param {import('estree').Node} root
 * @param {import('estree').Node} target
 */
function isAncestor(root, target) {
  let current = /** @type {{ parent?: import('estree').Node }} */ (target)
    .parent;
  while (current) {
    if (current === root) {
      return true;
    }
    current = /** @type {{ parent?: import('estree').Node }} */ (current)
      .parent;
  }
  return false;
}

/**
 * @param {import('eslint').Rule.RuleContext} context
 * @param {import('estree').Node} node
 * @param {string} globalName
 */
function reportGlobal(context, node, globalName) {
  context.report({
    node,
    message: `Nondeterministic global '${globalName}' is forbidden in the determinism scope.`,
  });
}

/** @type {import('eslint').Rule.RuleModule} */
const noNondeterministicGlobals = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow nondeterministic globals in core, helpers, and game hooks",
    },
    schema: [],
  },
  create(context) {
    return {
      Identifier(node) {
        const { name } = node;
        if (!BANNED_IDENTIFIERS.has(name)) {
          return;
        }
        const parent = /** @type {{ parent?: import('estree').Node }} */ (node)
          .parent;
        if (
          parent &&
          parent.type === "MemberExpression" &&
          /** @type {import('estree').MemberExpression} */ (parent).property ===
            node &&
          !(/** @type {import('estree').MemberExpression} */ (parent).computed)
        ) {
          return;
        }
        if (
          parent &&
          parent.type === "Property" &&
          /** @type {import('estree').Property} */ (parent).key === node &&
          !(/** @type {import('estree').Property} */ (parent).computed) &&
          !(/** @type {import('estree').Property} */ (parent).shorthand)
        ) {
          return;
        }
        if (isTypePosition(node)) {
          return;
        }
        if (!isGlobalIdentifier(context, node, name)) {
          return;
        }
        reportGlobal(context, node, name);
      },
      MemberExpression(node) {
        // Math.random
        if (
          node.object.type === "Identifier" &&
          node.object.name === "Math" &&
          !node.computed &&
          node.property.type === "Identifier" &&
          node.property.name === "random" &&
          isGlobalIdentifier(context, node.object, "Math")
        ) {
          reportGlobal(context, node, "Math.random");
          return;
        }

        // globalThis.<banned>
        if (
          node.object.type === "Identifier" &&
          node.object.name === "globalThis" &&
          !node.computed &&
          node.property.type === "Identifier" &&
          isGlobalIdentifier(context, node.object, "globalThis")
        ) {
          const prop = node.property.name;
          if (prop === "crypto" || BANNED_IDENTIFIERS.has(prop)) {
            reportGlobal(context, node, `globalThis.${prop}`);
            return;
          }
        }

        // globalThis.Math.random
        if (
          node.object.type === "MemberExpression" &&
          node.object.object.type === "Identifier" &&
          node.object.object.name === "globalThis" &&
          !node.object.computed &&
          node.object.property.type === "Identifier" &&
          node.object.property.name === "Math" &&
          !node.computed &&
          node.property.type === "Identifier" &&
          node.property.name === "random" &&
          isGlobalIdentifier(context, node.object.object, "globalThis")
        ) {
          reportGlobal(context, node, "Math.random");
        }
      },
    };
  },
};

/**
 * @param {import('eslint').Rule.RuleContext} context
 * @param {import('estree').Node} node
 * @param {string | null | undefined} specifier
 */
function reportImportIfBanned(context, node, specifier) {
  if (typeof specifier !== "string") {
    return;
  }
  if (!isNondeterministicSpecifier(specifier)) {
    return;
  }
  context.report({
    node,
    message: `Nondeterministic import '${specifier}' is forbidden in the determinism scope.`,
  });
}

/** @type {import('eslint').Rule.RuleModule} */
const noNondeterministicImports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow Node built-in imports in core, helpers, and game hooks",
    },
    schema: [],
  },
  create(context) {
    return {
      ImportDeclaration(node) {
        reportImportIfBanned(context, node.source, node.source.value);
      },
      ImportExpression(node) {
        if (
          node.source.type === "Literal" &&
          typeof node.source.value === "string"
        ) {
          reportImportIfBanned(context, node.source, node.source.value);
        }
      },
      ExportNamedDeclaration(node) {
        if (node.source) {
          reportImportIfBanned(context, node.source, node.source.value);
        }
      },
      ExportAllDeclaration(node) {
        if (node.source) {
          reportImportIfBanned(context, node.source, node.source.value);
        }
      },
    };
  },
};

/** @type {import('eslint').ESLint.Plugin} */
const plugin = {
  meta: {
    name: "cge",
    version: "0.0.0",
  },
  rules: {
    "no-nondeterministic-globals": noNondeterministicGlobals,
    "no-nondeterministic-imports": noNondeterministicImports,
  },
};

export default plugin;
