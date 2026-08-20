/*
 * Pluralization branch adapted from plur 6.0.0:
 * https://github.com/sindresorhus/plur/blob/v6.0.0/index.js
 * It consumes the irregular-plurals 4.2.0 tuple data vendored beside it.
 * Both upstream MIT notices are recorded in the repository NOTICE.
 */
import { IRREGULAR_PLURAL_PAIRS } from "./irregular-plurals.ts";

const irregularPlurals: ReadonlyMap<string, string> = new Map(IRREGULAR_PLURAL_PAIRS);

/** Return the plur 6.0.0 plural form of one authored spelling. */
export function pluralize(word: string): string {
  let plural: string;
  const irregular = irregularPlurals.get(word.toLowerCase());
  if (irregular !== undefined) {
    plural = irregular;

    const firstLetter = word.charAt(0);
    const isFirstLetterUpperCase = firstLetter === firstLetter.toUpperCase();
    if (isFirstLetterUpperCase) plural = firstLetter + plural.slice(1);

    const isWholeWordUpperCase = word === word.toUpperCase();
    if (isWholeWordUpperCase) plural = plural.toUpperCase();
  } else {
    plural = (
      word.replace(/(?:s|x|z|ch|sh)$/i, "$&e").replace(/([^aeiou])y$/i, "$1ie") + "s"
    ).replace(/i?e?s$/i, (match) => {
      const isTailLowerCase = word.slice(-1) === word.slice(-1).toLowerCase();
      return isTailLowerCase ? match.toLowerCase() : match.toUpperCase();
    });
  }

  return plural;
}
