/**
 * The {@link $vars} proxy: the source of logic variables for reaction functions.
 *
 * Reading any string property returns a brand-new `Symbol` named after that
 * property, so destructuring binds each name to a unique logic variable:
 *
 * ```ts
 * const { user, post } = $vars; // two distinct symbols, described "user"/"post"
 * ```
 *
 * Symbols give every variable a stable identity that doubles as a frame key,
 * while their `.description` keeps rendered output human-readable.
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
