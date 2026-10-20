/** Test helper: true iff every object/array reachable from `value` is frozen. */
export function isDeepFrozen(value: unknown): boolean {
  const seen = new Set<object>();
  const stack: unknown[] = [value];
  while (stack.length > 0) {
    const current = stack.pop();
    if (typeof current !== "object" || current === null || seen.has(current)) {
      continue;
    }
    seen.add(current);
    if (!Object.isFrozen(current)) {
      return false;
    }
    for (const key of Reflect.ownKeys(current)) {
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (descriptor !== undefined && "value" in descriptor) {
        stack.push(descriptor.value);
      }
    }
  }
  return true;
}
