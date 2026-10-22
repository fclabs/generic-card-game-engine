import type { SeatId } from "../session/ids.js";

/** The four roles every game has (PFR-001). */
export type BuiltInRole = "player" | "dealer" | "auditor" | "render";

/** A privileged built-in role: denied until the definition registers it (PBR-003). */
export type PrivilegedRole = "dealer" | "auditor";

/** The role and optional subject a query is projected for (spec §7.1). */
export interface ViewerIdentity {
  readonly role: string;
  readonly subject?: SeatId;
}

export type SubjectRule = "required" | "optional" | "forbidden";

export interface RoleEntry {
  readonly id: string;
  readonly subject: SubjectRule;
  readonly builtIn: boolean;
}

/** Roles of a definition and which privileged roles it registers (PFR-001). Deeply frozen. */
export interface RoleRegistry {
  readonly roles: readonly RoleEntry[];
  readonly registeredPrivileged: readonly PrivilegedRole[];
}
