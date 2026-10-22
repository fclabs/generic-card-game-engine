export type {
  BuiltInRole,
  PrivilegedRole,
  RoleEntry,
  RoleRegistry,
  SubjectRule,
  ViewerIdentity,
} from "./types.js";
export { buildRoleRegistry, validateViewer } from "./roles.js";
export {
  buildVisibilityPolicy,
  isEntitled,
  resolveAudience,
} from "./policy.js";
export type { VisibilityPolicy } from "./policy.js";
export type {
  CardView,
  Delta,
  DeltaEntry,
  GateView,
  GrantView,
  View,
  ZoneView,
} from "./types.js";
export { sealBatch } from "./privileged-batch.js";
export type { PrivilegedBatch } from "./privileged-batch.js";
export { projectView } from "./project-view.js";
export { VIEW_SECTION_ORDER } from "./make-view.js";
export {
  buildEntitlementContext,
  expandGrantee,
  isEntitledToCardKey,
  isEntitledToZoneKey,
  isGrantee,
  isGrantInScope,
  isStaticallyEntitledToGrant,
  isStaticallyEntitledToZoneKey,
  resolveGrantTarget,
  withoutGrants,
} from "./entitlement.js";
export type {
  CardKey,
  EntitlementContext,
  GrantSelection,
  ZoneKey,
} from "./entitlement.js";
