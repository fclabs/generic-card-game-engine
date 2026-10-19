/**
 * Own-property-safe helpers for the plain records that hold keyed state. Ids may
 * legitimately be `__proto__` (it matches the id charset), so reads must not fall
 * through to `Object.prototype` and writes must not go through assignment.
 */

export function hasOwn(record: object, key: string): boolean {
  return Object.hasOwn(record, key);
}

/** `record[key]` when `key` is an own property, else `undefined` (never inherited). */
export function getOwn<V>(
  record: Readonly<Record<string, V>>,
  key: string,
): V | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

/** Defines an own enumerable data property (safe for `__proto__`). For records the caller owns. */
export function setOwn<V>(
  record: Record<string, V>,
  key: string,
  value: V,
): void {
  Object.defineProperty(record, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}
