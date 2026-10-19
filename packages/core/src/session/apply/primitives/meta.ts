import { ok } from "../../../errors/result.js";
import type { Result } from "../../../errors/result.js";
import { metaPartitionNode } from "../../../replay/canonical/state-schema.js";
import type { Action, MetaAction } from "../../actions.js";
import { getOwn } from "../../records.js";
import type { JsonValue } from "../../state.js";
import type { ApplyContext } from "../context.js";
import { invokeReducer, recheck } from "../reducer.js";
import { applyEngineAction, ENGINE_PREFIX } from "./engine.js";

/**
 * `meta{schema_id, payload}` (KFR-042/051): `engine.*` goes to the engine reducers, a schema
 * the definition registers goes through the generic reducer step (which owns only
 * `meta[schema_id]`), anything else is `MALFORMED_ACTION`.
 */
export function applyMeta(
  ctx: ApplyContext,
  action: MetaAction,
): Result<Action> {
  if (action.schema_id.startsWith(ENGINE_PREFIX)) {
    return applyEngineAction(ctx, action);
  }
  const decl = ctx.def.metaSchemas.find((m) => m.id === action.schema_id);
  const reducer = decl?.reducer;
  if (decl === undefined || reducer === undefined) {
    return ctx.fail(
      "MALFORMED_ACTION",
      `unregistered meta schema_id: ${action.schema_id}`,
      ctx.path(".schema_id"),
    );
  }
  const name = `meta ${decl.id}`;
  const partition: JsonValue = getOwn(ctx.work.state.meta, decl.id) ?? {};
  const out = invokeReducer(ctx, reducer, partition, action.payload, {
    name,
    schema: metaPartitionNode(decl.fields),
  });
  if (!out.ok) return out;
  ctx.work.patch("meta", decl.id, out.value);
  const rechecked = recheck(ctx, name);
  return rechecked.ok ? ok(action) : rechecked;
}
