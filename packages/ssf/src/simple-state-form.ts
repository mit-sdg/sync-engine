import { parseGrammar } from "./grammar.ts";
import type { SsfParseOptions, SsfParseResult, SsfTypeInventory } from "./model.ts";
import { resolveGrammar } from "./resolution.ts";
import { sourceLines, tokenizeSimpleStateForm } from "./source.ts";

/** Enumerate exact structural, explicit-alias, and evidenced-alias spellings. */
export function ownedTypeNameSpellings(inventory: SsfTypeInventory): readonly string[] {
  return inventory.ownedTypeNames;
}

/** Parse and validate the bounded structural SSF grammar. */
export function parseSimpleStateForm(
  source: string,
  options: SsfParseOptions = {},
): SsfParseResult {
  const tokens = tokenizeSimpleStateForm(source);
  return resolveGrammar(parseGrammar(sourceLines(source, tokens)), options);
}

/** Return deterministic, source-located SSF diagnostics. */
export function validateSimpleStateForm(
  source: string,
  options: SsfParseOptions = {},
): SsfParseResult["diagnostics"] {
  return parseSimpleStateForm(source, options).diagnostics;
}
