/**
 * The 24 engine error codes (spec KFR-002): design §3.4 plus `STALE_WRITER`.
 * Game-defined rejections use `GameRejection`, never these codes.
 */
export const ERROR_CODES = [
  "IDEMPOTENCY_CONFLICT",
  "STALE",
  "STALE_WRITER",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "UNKNOWN_ROLE",
  "UNKNOWN_SUBJECT",
  "SUBJECT_NOT_ALLOWED",
  "VIEW_DENIED",
  "NOT_YOUR_TURN",
  "NOT_READY",
  "GATE_CLOSED",
  "CARD_NOT_IN_ZONE",
  "EMPTY_ZONE",
  "COUNTER_BOUNDS",
  "ZONE_LIMIT",
  "REDUCER_ERROR",
  "MALFORMED_ACTION",
  "SESSION_ENDED",
  "REPLAY_INVALID",
  "REPLAY_MISMATCH",
  "HOOK_ERROR",
  "HOOK_TIMEOUT",
  "CASCADE_LIMIT",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];
