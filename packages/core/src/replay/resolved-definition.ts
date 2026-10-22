import type { CompiledGameDefinition } from "../definition/types.js";
import type { DefinitionId } from "../session/ids.js";

/**
 * What `DefinitionRegistry.resolve` yields plus the id it was resolved by (spec §4.7): the
 * pair every replay, export and fork function binds a package to.
 */
export interface ResolvedDefinition {
  readonly definitionId: DefinitionId;
  readonly definition: CompiledGameDefinition;
}
