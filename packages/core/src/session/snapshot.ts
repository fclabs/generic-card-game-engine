type Primitive = string | number | boolean | bigint | symbol | null | undefined;
// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
type Callable = Function;

/** Recursively `readonly` over arrays, records and nested objects; `bigint` and primitives untouched. */
export type DeepReadonly<T> = T extends Primitive | Callable
  ? T
  : T extends readonly (infer U)[]
    ? readonly DeepReadonly<U>[]
    : { readonly [K in keyof T]: DeepReadonly<T[K]> };

/** A state exposed to consumers: any write through it is a compile error (KFR-011). */
export type Snapshot<T> = DeepReadonly<T>;

/**
 * Freezes `value` and every object/array reachable from it (iterative; safe for
 * deep graphs and cycles). It always descends, so already-frozen shells with
 * unfrozen children are still completed. `bigint` and other primitives are left as-is.
 */
export function deepFreeze<T>(value: T): Snapshot<T> {
  const seen = new Set<object>();
  const stack: unknown[] = [value];
  while (stack.length > 0) {
    const current = stack.pop();
    if (typeof current !== "object" || current === null || seen.has(current)) {
      continue;
    }
    seen.add(current);
    Object.freeze(current);
    for (const key of Reflect.ownKeys(current)) {
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (descriptor !== undefined && "value" in descriptor) {
        stack.push(descriptor.value);
      }
    }
  }
  return value as Snapshot<T>;
}
