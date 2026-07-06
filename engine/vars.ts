/**
 * The {@link $vars} proxy: the source of logic variables for sync functions.
 *
 * Reading any string property returns a brand-new `Symbol` named after that
 * property, so destructuring binds each name to a unique logic variable:
 *
 * ```ts
 * const { user, post } = $vars; // two distinct symbols, described "user"/"post"
 * ```
 *
 * Symbols give every variable a stable identity that doubles as a frame key,
 * while their `.description` keeps logs and `collectAs` output human-readable.
 */
import type { Vars } from "./types.ts";

export const $vars = new Proxy({} as Vars, {
  get(_target, prop) {
    if (typeof prop === "string") {
      return Symbol(prop);
    }
    return undefined;
  },
}) as Vars;

/**
 * A logic variable branded with the type its binding carries.
 *
 * At runtime a `Var<T>` is an ordinary `symbol` (a frame key); the phantom `T`
 * exists only at compile time so a frame read can recover the value's type
 * without a cast at the call site (see `read` in {@link ./where.ts}). The brand
 * is optional so a plain `symbol` still satisfies `Var<unknown>`, keeping the
 * untyped `$vars` proxy compatible.
 */
export type Var<T = unknown> = symbol & { readonly __varType?: T };

/** A record of {@link Var}s, one per declared variable, carrying its type. */
export type TypedVars<TSchema extends Record<string, unknown>> = {
  readonly [K in keyof TSchema]: Var<TSchema[K]>;
};

/**
 * Declare a file's logic-variable vocabulary, typed.
 *
 * Each property access returns a stable `Var<T>` (memoized, unlike {@link $vars}
 * which mints a fresh symbol every read) so the same name denotes the same
 * variable across every sync in the file — a single, typed source of truth for
 * what each binding holds. Optional request fields should be declared with
 * `| undefined` so {@link read} reflects that they may be absent.
 *
 * ```ts
 * const v = declareVars<{ session: string; amount: number; group?: string }>();
 * const { session, amount, group } = v;
 * ```
 */
export function declareVars<TSchema extends Record<string, unknown>>(): TypedVars<TSchema> {
  const cache = new Map<string, symbol>();
  return new Proxy({} as TypedVars<TSchema>, {
    get(_target, prop) {
      if (typeof prop !== "string") return undefined;
      let existing = cache.get(prop);
      if (existing === undefined) {
        existing = Symbol(prop);
        cache.set(prop, existing);
      }
      return existing;
    },
  });
}
