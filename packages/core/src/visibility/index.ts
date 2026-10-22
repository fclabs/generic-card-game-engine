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
