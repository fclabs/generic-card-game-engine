import type { CompiledGameDefinition } from "../definition/types.js";
import { err, ok } from "../errors/result.js";
import type { Result } from "../errors/result.js";
import type { SeatId } from "../session/ids.js";
import { hasOwn } from "../session/records.js";
import type { Snapshot } from "../session/snapshot.js";
import type { SessionState } from "../session/state.js";
import type {
  PrivilegedRole,
  RoleEntry,
  RoleRegistry,
  ViewerIdentity,
} from "./types.js";

/** Built-in roles in canonical order (PFR-001). */
const BUILT_INS: readonly RoleEntry[] = [
  { id: "player", subject: "required", builtIn: true },
  { id: "dealer", subject: "forbidden", builtIn: true },
  { id: "auditor", subject: "forbidden", builtIn: true },
  { id: "render", subject: "optional", builtIn: true },
];

const PRIVILEGED: readonly PrivilegedRole[] = ["dealer", "auditor"];

export function isPrivilegedRole(role: string): role is PrivilegedRole {
  return role === "dealer" || role === "auditor";
}

/** Every `visibility` block of the definition (zones, templates, counters). */
function visibilityBlocks(def: CompiledGameDefinition): readonly object[] {
  return [
    ...def.zones.map((z) => z.visibility),
    ...def.zoneTemplates.map((t) => t.visibility),
    ...def.counters.map((c) => c.visibility),
  ];
}

/**
 * Builds the role registry (PFR-001, PBR-003, PBR-006). Pure and total; the
 * result is deeply frozen, so nothing can register a role afterwards. A
 * privileged role is registered iff some zone, template or counter
 * `visibility` has an entry keyed by it; `default` never registers.
 */
export function buildRoleRegistry(def: CompiledGameDefinition): RoleRegistry {
  const blocks = visibilityBlocks(def);
  const roles: readonly RoleEntry[] = [
    ...BUILT_INS.map((r) => Object.freeze({ ...r })),
    ...def.roles.map((r) =>
      Object.freeze({ id: r.id, subject: r.subject, builtIn: false }),
    ),
  ];
  const registeredPrivileged = PRIVILEGED.filter((role) =>
    blocks.some((block) => hasOwn(block, role)),
  );
  return Object.freeze({
    roles: Object.freeze(roles),
    registeredPrivileged: Object.freeze(registeredPrivileged),
  });
}

/**
 * Validates a viewer (PFR-002..005) in this order: role known, subject rule,
 * subject is a declared seat, privileged role registered. The first failure is
 * returned. `detail` names only the role and subject the caller supplied
 * (PBR-008).
 */
export function validateViewer(
  registry: RoleRegistry,
  state: Snapshot<SessionState>,
  viewer: ViewerIdentity,
): Result<ViewerIdentity> {
  const entry = registry.roles.find((r) => r.id === viewer.role);
  if (entry === undefined) {
    return err({
      code: "UNKNOWN_ROLE",
      detail: `unknown role ${JSON.stringify(viewer.role)}`,
    });
  }
  const subject: SeatId | undefined = viewer.subject;
  if (entry.subject === "forbidden" && subject !== undefined) {
    return err({
      code: "SUBJECT_NOT_ALLOWED",
      detail: `role ${JSON.stringify(viewer.role)} takes no subject, got ${JSON.stringify(subject)}`,
    });
  }
  if (entry.subject === "required" && subject === undefined) {
    return err({
      code: "UNKNOWN_SUBJECT",
      detail: `role ${JSON.stringify(viewer.role)} requires a subject seat`,
    });
  }
  if (subject !== undefined && !hasOwn(state.roster.seats, subject)) {
    return err({
      code: "UNKNOWN_SUBJECT",
      detail: `subject ${JSON.stringify(subject)} is not a declared seat`,
    });
  }
  if (
    isPrivilegedRole(viewer.role) &&
    !registry.registeredPrivileged.includes(viewer.role)
  ) {
    return err({
      code: "VIEW_DENIED",
      detail: `role ${JSON.stringify(viewer.role)} is not registered by this definition`,
    });
  }
  return ok(viewer);
}
