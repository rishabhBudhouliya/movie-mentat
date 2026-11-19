// Nominal ("branded") types: a UserId is a string, but a plain string is not a
// UserId. Values are branded only where they're parsed or read from the DB.
declare const brand: unique symbol;
export type Brand<T, B extends string> = T & { readonly [brand]: B };

export type UserId = Brand<string, "UserId">;
export type TmdbId = Brand<number, "TmdbId">;
export type FactId = Brand<string, "FactId">;
