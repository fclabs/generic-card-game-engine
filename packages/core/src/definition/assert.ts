import { err, ok } from "../errors/result.js";
import type { Result } from "../errors/result.js";
import { hasOwn } from "../session/records.js";
import type { JsonValue } from "../session/state.js";
import type { CompiledGameDefinition, FieldType } from "./types.js";

const TEMPLATE_NAME_MAX = 48;

function violation(detail: string): Result<void> {
  return err({ code: "MALFORMED_ACTION", detail });
}

function matchesType(type: FieldType, value: JsonValue): boolean {
  switch (type) {
    case "string":
      return typeof value === "string";
    case "int":
      return typeof value === "number";
    case "bool":
      return typeof value === "boolean";
    case "json":
      return true;
  }
}

/** First duplicate id in `ids`, or undefined. */
function firstDuplicate(ids: readonly string[]): string | undefined {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) return id;
    seen.add(id);
  }
  return undefined;
}

/**
 * Structural check of a compiled definition (KFR-101). Returns the first
 * violation, in the order the spec lists them; the error names the entity.
 * Violations are `MALFORMED_ACTION` (the reserved-namespace rule, KFR-052).
 */
export function assertDefinitionStructure(
  def: CompiledGameDefinition,
): Result<void> {
  const zoneIds = new Set<string>(def.zones.map((z) => z.id));
  const counterById = new Map(def.counters.map((c) => [c.id as string, c]));
  const seatIds = new Set<string>(def.seats.map((s) => s.id));

  const dupCard = firstDuplicate(def.cards.map((c) => c.id));
  if (dupCard !== undefined) return violation(`duplicate card id: ${dupCard}`);

  for (const card of def.cards) {
    if (typeof card.startingZone !== "string" || card.startingZone === "") {
      return violation(`card ${card.id} has no starting zone`);
    }
    if (!zoneIds.has(card.startingZone)) {
      return violation(
        `card ${card.id} starts in unknown zone: ${card.startingZone}`,
      );
    }
    for (const [field, value] of Object.entries(card.initialMetadata)) {
      if (!hasOwn(card.metadataSchema, field)) {
        return violation(
          `card ${card.id} initialMetadata field ${field} is not declared in metadataSchema`,
        );
      }
      const type = card.metadataSchema[field];
      if (type === undefined || !matchesType(type, value)) {
        return violation(
          `card ${card.id} initialMetadata field ${field} must be of type ${String(type)}`,
        );
      }
    }
  }

  const dupZone = firstDuplicate(def.zones.map((z) => z.id));
  if (dupZone !== undefined) return violation(`duplicate zone id: ${dupZone}`);
  const dupCounter = firstDuplicate(def.counters.map((c) => c.id));
  if (dupCounter !== undefined) {
    return violation(`duplicate counter id: ${dupCounter}`);
  }
  const dupSeat = firstDuplicate(def.seats.map((s) => s.id));
  if (dupSeat !== undefined) return violation(`duplicate seat id: ${dupSeat}`);

  for (const group of def.conservationGroups) {
    for (const counterId of group.counters) {
      const counter = counterById.get(counterId);
      if (counter === undefined) {
        return violation(
          `conservation group ${group.id} names unknown counter: ${counterId}`,
        );
      }
      if (counter.derived !== undefined) {
        return violation(
          `conservation group ${group.id} names derived counter: ${counterId}`,
        );
      }
    }
  }

  for (const counter of def.counters) {
    const belowMin = counter.initial < counter.min;
    const aboveMax = counter.max !== undefined && counter.initial > counter.max;
    if (belowMin || aboveMax) {
      return violation(
        `counter ${counter.id} initial ${counter.initial} is outside its bounds`,
      );
    }
  }

  for (const schema of def.metaSchemas) {
    if (typeof schema.reducerRef !== "string" || schema.reducerRef === "") {
      return violation(`meta schema ${schema.id} has no reducer reference`);
    }
    if (schema.id.startsWith("engine.")) {
      return violation(
        `meta schema ${schema.id} uses the reserved engine. namespace`,
      );
    }
  }

  for (const template of def.zoneTemplates) {
    if (template.name.includes("/")) {
      return violation(`zone template ${template.name} contains "/"`);
    }
    if (template.name.length > TEMPLATE_NAME_MAX) {
      return violation(
        `zone template ${template.name} exceeds ${TEMPLATE_NAME_MAX} characters`,
      );
    }
  }

  const { control } = def;
  const turnOrderDup = firstDuplicate(control.turnOrder);
  if (turnOrderDup !== undefined) {
    return violation(`turn order repeats seat: ${turnOrderDup}`);
  }
  for (const seat of control.turnOrder) {
    if (!seatIds.has(seat)) {
      return violation(`turn order names undeclared seat: ${seat}`);
    }
  }
  for (const seat of def.seats) {
    if (!control.turnOrder.includes(seat.id)) {
      return violation(`turn order omits seat: ${seat.id}`);
    }
  }

  if (!control.phases.includes(control.initialPhase)) {
    return violation(
      `initial phase ${control.initialPhase} is not in the phase set`,
    );
  }
  for (const seat of control.initialActiveSeats) {
    if (!seatIds.has(seat)) {
      return violation(`initial active seat is not declared: ${seat}`);
    }
  }

  const teamIds = new Set<string>(def.teams);
  for (const seat of def.seats) {
    if (seat.team !== undefined && !teamIds.has(seat.team)) {
      return violation(`seat ${seat.id} names undeclared team: ${seat.team}`);
    }
  }

  if (def.viewKeys.length === 0) return violation("viewKeys is empty");
  for (const key of def.viewKeys) {
    if (key === "") return violation("viewKeys contains an empty entry");
  }
  const dupKey = firstDuplicate(def.viewKeys);
  if (dupKey !== undefined)
    return violation(`duplicate viewKeys entry: ${dupKey}`);

  return ok(undefined);
}
