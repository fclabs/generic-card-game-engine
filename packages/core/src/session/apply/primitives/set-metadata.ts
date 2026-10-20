import { ok } from "../../../errors/result.js";
import type { Result } from "../../../errors/result.js";
import type { FieldType } from "../../../definition/types.js";
import type { Action, SetMetadataAction } from "../../actions.js";
import { hasOwn } from "../../records.js";
import type { JsonValue } from "../../state.js";
import type { ApplyContext } from "../context.js";

function matches(type: FieldType, value: JsonValue): boolean {
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

/**
 * `set_metadata` (KFR-033): every field must be declared by the card's metadata schema with a
 * matching type (`int` = JSON number; payloads are already integer-only). Only those fields change.
 */
export function applySetMetadata(
  ctx: ApplyContext,
  action: SetMetadataAction,
): Result<Action> {
  const card = ctx.work.card(action.card_id);
  const decl = ctx.index.card(action.card_id);
  if (card === undefined || decl === undefined) {
    return ctx.fail(
      "MALFORMED_ACTION",
      `unknown card: ${action.card_id}`,
      ctx.path(".card_id"),
    );
  }
  const names = Object.keys(action.fields);
  for (const name of names) {
    const path = ctx.path(`.fields.${name}`);
    if (!hasOwn(decl.metadataSchema, name)) {
      return ctx.fail(
        "MALFORMED_ACTION",
        `card ${action.card_id} declares no metadata field: ${name}`,
        path,
      );
    }
    const type = decl.metadataSchema[name];
    const value = action.fields[name];
    if (type === undefined || value === undefined || !matches(type, value)) {
      return ctx.fail(
        "MALFORMED_ACTION",
        `metadata field ${name} of card ${action.card_id} must be of type ${String(type)}`,
        path,
      );
    }
  }
  if (names.length > 0) {
    // Spread copies own `__proto__` keys as data; later keys override earlier ones.
    ctx.work.putCard(action.card_id, {
      ...card,
      metadata: { ...card.metadata, ...action.fields },
    });
  }
  return ok(action);
}
