import {
  LineCounter,
  isAlias,
  isMap,
  isScalar,
  isSeq,
  parseDocument,
  type Document,
  type ParsedNode,
} from "yaml";
import { MAX_DEFINITION_ERRORS } from "@cge/core";
import type { DefinitionError, JsonValue, Result } from "@cge/core";

/** Options of `parseYaml`. Both limits are inclusive: `maxBytes` bytes / `maxAliases` aliases are accepted. */
export interface ParseYamlOptions {
  /** Largest accepted UTF-8 size of the text in bytes. Default 1_048_576. */
  readonly maxBytes?: number;
  /** Largest accepted number of alias nodes (`*name`) in the document. Default 100. */
  readonly maxAliases?: number;
}

export const DEFAULT_MAX_YAML_BYTES = 1_048_576;
export const DEFAULT_MAX_YAML_ALIASES = 100;

/**
 * Multiplier turning `maxAliases` into the library's expansion guard
 * (`maxAliasCount` of `yaml`, a product of reference count and nesting weight).
 */
const EXPANSION_FACTOR = 100;

interface Position {
  readonly line: number;
  readonly col: number;
}

/**
 * Parses YAML 1.2 (core schema) into plain JSON data. Pure and total: it
 * never throws, never reads files, the network or the environment.
 */
export function parseYaml(
  text: string,
  opts?: ParseYamlOptions,
): Result<JsonValue, readonly DefinitionError[]> {
  try {
    return parse(text, opts);
  } catch (e) {
    return fail([
      {
        code: "YAML_SYNTAX",
        path: "",
        detail: `YAML could not be parsed: ${describeThrown(e)}`,
      },
    ]);
  }
}

function parse(
  text: string,
  opts: ParseYamlOptions | undefined,
): Result<JsonValue, readonly DefinitionError[]> {
  const maxBytes = opts?.maxBytes ?? DEFAULT_MAX_YAML_BYTES;
  const maxAliases = opts?.maxAliases ?? DEFAULT_MAX_YAML_ALIASES;

  // Size pre-check: UTF-8 size, before any parsing (DFR-002). Every UTF-16
  // unit is at least one byte, so a longer string is too large without measuring.
  if (text.length > maxBytes || Buffer.byteLength(text, "utf8") > maxBytes) {
    return fail([
      {
        code: "YAML_TOO_LARGE",
        path: "",
        detail: `document exceeds the limit of ${String(maxBytes)} bytes (UTF-8)`,
      },
    ]);
  }

  const lineCounter = new LineCounter();
  const doc = parseDocument(text, {
    version: "1.2",
    schema: "core",
    uniqueKeys: true,
    merge: false,
    keepSourceTokens: false,
    lineCounter,
    prettyErrors: false,
  });
  const at = (offset: number): Position => lineCounter.linePos(offset);

  if (doc.errors.length > 0) {
    return fail(
      doc.errors
        .slice(0, MAX_DEFINITION_ERRORS)
        .map((e) => mapParserError(e, text, at)),
    );
  }

  const errors: DefinitionError[] = [];
  const add = (
    code: DefinitionError["code"],
    path: string,
    offset: number,
    detail: string,
  ): void => {
    if (errors.length >= MAX_DEFINITION_ERRORS) return;
    const p = at(offset);
    errors.push({
      code,
      path,
      detail: `${detail} (line ${String(p.line)}, column ${String(p.col)})`,
    });
  };

  if (doc.directives.yaml.explicit && doc.directives.yaml.version !== "1.2") {
    add(
      "YAML_FORBIDDEN_FEATURE",
      "",
      0,
      `YAML version ${doc.directives.yaml.version} is not supported (only 1.2)`,
    );
  }
  if (doc.contents === null) {
    add("YAML_FORBIDDEN_FEATURE", "", 0, "empty document: there is no content");
  } else {
    const walker = new Walker(doc, add, maxAliases);
    walker.walk(doc.contents, "");
  }
  if (errors.length > 0) return fail(errors);

  let value: unknown;
  try {
    value = doc.toJS({ maxAliasCount: maxAliases * EXPANSION_FACTOR });
  } catch (e) {
    if (e instanceof ReferenceError) {
      // "Excessive alias count": the library's expansion guard fired.
      return fail([
        {
          code: "YAML_FORBIDDEN_FEATURE",
          path: "",
          detail: `alias expansion exceeds the limit (${String(maxAliases)} aliases): ${e.message}`,
        },
      ]);
    }
    throw e;
  }
  return { ok: true, value: value as JsonValue };
}

type Add = (
  code: DefinitionError["code"],
  path: string,
  offset: number,
  detail: string,
) => void;

/**
 * Walks the document AST once (aliases are leaves, never followed) and
 * reports every forbidden feature, so the cost is linear in the text size.
 */
class Walker {
  private aliases = 0;
  private aliasLimitReported = false;

  constructor(
    private readonly doc: Document.Parsed,
    private readonly add: Add,
    private readonly maxAliases: number,
  ) {}

  walk(node: ParsedNode | null, path: string): void {
    if (node === null) return;
    const offset = node.range[0];
    if (isAlias(node)) {
      this.aliases += 1;
      if (this.aliases > this.maxAliases && !this.aliasLimitReported) {
        this.aliasLimitReported = true;
        this.add(
          "YAML_FORBIDDEN_FEATURE",
          path,
          offset,
          `more than ${String(this.maxAliases)} aliases (limit maxAliases)`,
        );
      }
      return;
    }
    if (node.tag !== undefined) {
      this.add(
        "YAML_FORBIDDEN_FEATURE",
        path,
        offset,
        `explicit tag ${node.tag} is not allowed`,
      );
    }
    if (isScalar(node)) {
      const v: unknown = node.value;
      if (typeof v === "number" && !Number.isFinite(v)) {
        this.add(
          "YAML_FORBIDDEN_FEATURE",
          path,
          offset,
          "non-finite number (.inf, .nan) is not allowed",
        );
      } else if (typeof v === "bigint") {
        this.add(
          "YAML_FORBIDDEN_FEATURE",
          path,
          offset,
          "bigint scalars are not allowed",
        );
      }
      return;
    }
    if (isSeq(node)) {
      node.items.forEach((item, i) => {
        this.walk(item, `${path}[${String(i)}]`);
      });
      return;
    }
    if (isMap(node)) {
      const seen = new Set<string>();
      for (const pair of node.items) {
        const key = this.keyText(pair.key, path);
        if (key !== undefined) {
          if (seen.has(key.text)) {
            this.add(
              "YAML_DUPLICATE_KEY",
              joinPath(path, key.text),
              key.offset,
              `duplicate key "${key.text}"`,
            );
          }
          seen.add(key.text);
        }
        const child = key === undefined ? path : joinPath(path, key.text);
        this.walk(pair.value, child);
      }
    }
  }

  /** The string value of a mapping key, or `undefined` after reporting a forbidden key. */
  private keyText(
    key: ParsedNode | null,
    path: string,
  ): { text: string; offset: number } | undefined {
    if (key === null) return undefined;
    const offset = key.range[0];
    let target: unknown = key;
    if (isAlias(key)) {
      this.aliases += 1;
      if (this.aliases > this.maxAliases && !this.aliasLimitReported) {
        this.aliasLimitReported = true;
        this.add(
          "YAML_FORBIDDEN_FEATURE",
          path,
          offset,
          `more than ${String(this.maxAliases)} aliases (limit maxAliases)`,
        );
      }
      target = key.resolve(this.doc);
    } else if (key.tag !== undefined) {
      this.add(
        "YAML_FORBIDDEN_FEATURE",
        path,
        offset,
        `explicit tag ${key.tag} is not allowed`,
      );
    }
    if (!isScalar(target) || typeof target.value !== "string") {
      this.add(
        "YAML_FORBIDDEN_FEATURE",
        path,
        offset,
        "mapping keys must be strings",
      );
      return undefined;
    }
    if (target.value === "__proto__") {
      this.add(
        "YAML_FORBIDDEN_FEATURE",
        path,
        offset,
        'the key "__proto__" is not allowed',
      );
      return undefined;
    }
    if (target.value === "<<") {
      this.add(
        "YAML_FORBIDDEN_FEATURE",
        path,
        offset,
        'merge keys ("<<") are not allowed',
      );
      return undefined;
    }
    return { text: target.value, offset };
  }
}

function joinPath(base: string, key: string): string {
  return base === "" ? key : `${base}.${key}`;
}

function mapParserError(
  e: {
    code: string;
    message: string;
    pos: [number, number];
    linePos?: readonly Position[];
  },
  text: string,
  at: (offset: number) => Position,
): DefinitionError {
  const p = e.linePos?.[0] ?? at(e.pos[0]);
  const where = `(line ${String(p.line)}, column ${String(p.col)})`;
  const firstLine = e.message.split("\n")[0] ?? e.message;
  if (e.code === "DUPLICATE_KEY") {
    const key = text.slice(e.pos[0], e.pos[1]).trim();
    return {
      code: "YAML_DUPLICATE_KEY",
      path: "",
      detail: `duplicate key ${JSON.stringify(key)} ${where}`,
    };
  }
  if (e.code === "MULTIPLE_DOCS") {
    return {
      code: "YAML_FORBIDDEN_FEATURE",
      path: "",
      detail: `multiple documents are not allowed ${where}`,
    };
  }
  return { code: "YAML_SYNTAX", path: "", detail: `${firstLine} ${where}` };
}

function fail(errors: DefinitionError[]): {
  ok: false;
  error: readonly DefinitionError[];
} {
  return { ok: false, error: errors };
}

function describeThrown(e: unknown): string {
  return e instanceof Error ? e.message : "unknown failure";
}
