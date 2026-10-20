import { afterEach, describe, expect, it } from "vitest";
import {
  assertDefinitionStructure,
  definitionContentHash,
  definitionData,
} from "@cge/core";
import type { CompiledGameDefinition, DefinitionId } from "@cge/core";
import type { DefinitionRegistry } from "@cge/core";

/**
 * One registry under test, plus the means to change its backing definition.
 * `expected` is a fresh compile of the sources `id` was produced from.
 * An optional edit that an adapter cannot perform is simply left out and
 * its test is skipped.
 */
export interface RegistryContractFixture {
  readonly registry: DefinitionRegistry;
  readonly id: DefinitionId;
  readonly expected: CompiledGameDefinition;
  readonly edits: {
    /** Change the definition's meaning (a card's zone). */
    semantic(): void | Promise<void>;
    /** Change one byte of the hook bundle. */
    bundleByte?(): void | Promise<void>;
    /** Add a comment only; the identity must not change. */
    comment(): void | Promise<void>;
    /** Make the source no longer compile. */
    broken(): void | Promise<void>;
  };
  dispose(): void | Promise<void>;
}

/** Builds a fresh fixture; called once per test, so edits never leak. */
export type RegistryContractFactory = () => Promise<RegistryContractFixture>;

const UNKNOWN_ID = `sha256:${"0".repeat(64)}` as DefinitionId;

/**
 * DFR-054: the DefinitionRegistry contract. Run it with a factory for any adapter
 * (the filesystem adapter today). Registers its own `describe` block.
 */
export function runRegistryContract(
  adapter: string,
  factory: RegistryContractFactory,
): void {
  describe(`DefinitionRegistry contract: ${adapter} (DFR-053, DFR-054, DBR-011, VC-243)`, () => {
    const open: RegistryContractFixture[] = [];

    async function fixture(): Promise<RegistryContractFixture> {
      const f = await factory();
      open.push(f);
      return f;
    }

    afterEach(async () => {
      for (const f of open.splice(0)) await f.dispose();
    });

    it("resolves a loaded id to the same definition as a fresh compile", async () => {
      const f = await fixture();
      const result = await f.registry.resolve(f.id);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(definitionData(result.value)).toEqual(definitionData(f.expected));
      expect(definitionContentHash(result.value)).toBe(
        definitionContentHash(f.expected),
      );
      expect(() => {
        assertDefinitionStructure(result.value);
      }).not.toThrow();
    });

    it("returns UNKNOWN_DEFINITION for an id it never produced", async () => {
      const f = await fixture();
      const result = await f.registry.resolve(UNKNOWN_ID);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("UNKNOWN_DEFINITION");
    });

    it("returns DEFINITION_HASH_MISMATCH naming both ids after a semantic edit", async () => {
      const f = await fixture();
      await f.edits.semantic();
      const result = await f.registry.resolve(f.id);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("DEFINITION_HASH_MISMATCH");
      expect(result.error.detail).toContain(f.id);
      expect(result.error.detail).toMatch(/actual sha256:[0-9a-f]{64}/);
    });

    it("returns DEFINITION_HASH_MISMATCH after one byte of the bundle changes", async () => {
      const f = await fixture();
      if (f.edits.bundleByte === undefined) return;
      await f.edits.bundleByte();
      const result = await f.registry.resolve(f.id);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("DEFINITION_HASH_MISMATCH");
        expect(result.error.detail).toContain(f.id);
      }
    });

    it("still resolves after a semantics-preserving (comment-only) edit", async () => {
      const f = await fixture();
      await f.edits.comment();
      const result = await f.registry.resolve(f.id);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(definitionContentHash(result.value)).toBe(
          definitionContentHash(f.expected),
        );
      }
      // A second call is served consistently.
      expect((await f.registry.resolve(f.id)).ok).toBe(true);
    });

    it("returns DEFINITION_INVALID when the source no longer compiles", async () => {
      const f = await fixture();
      await f.edits.broken();
      const result = await f.registry.resolve(f.id);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("DEFINITION_INVALID");
    });
  });
}
