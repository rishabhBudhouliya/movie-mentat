/**
 * Exhaustiveness helper for discriminated unions. Call this in the `default`
 * (or final) branch of a `switch` over a union's `kind`/tag field. If every
 * variant is handled, `value` is narrowed to `never` and this compiles; if a
 * new variant is added to the union without a matching case, TypeScript
 * reports a compile error at the call site instead of a runtime surprise.
 */
export function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${JSON.stringify(value)}`);
}
