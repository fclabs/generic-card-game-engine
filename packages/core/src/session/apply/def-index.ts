import type {
  CardDecl,
  CompiledGameDefinition,
  ZoneDecl,
  ZoneTemplateDecl,
} from "../../definition/types.js";
import type { ZoneState } from "../state.js";

/** Lazy lookup tables over a definition, built per `apply` call (nothing is cached across calls). */
export interface DefIndex {
  zone(id: string): ZoneDecl | undefined;
  template(name: string): ZoneTemplateDecl | undefined;
  card(id: string): CardDecl | undefined;
  /** Whether a zone keeps order: its template's flag for template zones, else its declaration's. */
  isOrdered(id: string, zone: Pick<ZoneState, "template">): boolean;
}

function lazyMap<T>(items: readonly T[], key: (item: T) => string) {
  let map: Map<string, T> | undefined;
  return (id: string): T | undefined => {
    map ??= new Map(items.map((item) => [key(item), item]));
    return map.get(id);
  };
}

export function indexDefinition(def: CompiledGameDefinition): DefIndex {
  const zone = lazyMap(def.zones, (z) => z.id);
  const template = lazyMap(def.zoneTemplates, (t) => t.name);
  const card = lazyMap(def.cards, (c) => c.id);
  return {
    zone,
    template,
    card,
    isOrdered(id, state) {
      if (state.template !== undefined) {
        return template(state.template)?.ordered ?? false;
      }
      return zone(id)?.ordered ?? false;
    },
  };
}
