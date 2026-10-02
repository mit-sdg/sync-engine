import { ENUM_VALUE, FIELD_NAME, impliedName, RESERVED_NAMES, TYPE_NAME } from "./names.ts";
import {
  error,
  type ParsedAlias,
  type ParsedDeclaration,
  type ParsedField,
  type ParsedFieldType,
  type ParsedNamed,
  type ParsedReference,
  type ParsedSubsetCondition,
  type ParsedUniqueConstraint,
  type SourceLine,
  type SsfDiagnostic,
  type SsfMultiplicity,
  type SsfRuleLine,
  type SsfToken,
} from "./model.ts";
import { lineSpan, ruleLine, span, words } from "./source.ts";

const NEAR_MISS_STRUCTURAL = new Map<string, SsfMultiplicity>([
  ["array", "sequence"],
  ["list", "sequence"],
  ["sequence", "sequence"],
  ["sequences", "sequence"],
  ["singleton", "element"],
]);
const RULE_MARKER = "Rule:";
const NEAR_MISS_RULE_MARKERS = [
  "rule:",
  "RULE:",
  "Invariant:",
  "invariant:",
  "Note:",
  "note:",
] as const;

export interface GrammarResult {
  readonly declarations: readonly ParsedDeclaration[];
  readonly aliases: readonly ParsedAlias[];
  readonly rules: readonly SsfRuleLine[];
  readonly diagnostics: readonly SsfDiagnostic[];
}

interface ParsingDeclaration extends ParsedDeclaration {
  hasMalformedField: boolean;
  /** Whether the body holds a field whose only fault has a repair, such as `a Set`. */
  hasRepairableField: boolean;
  /** The qualified spelling of a subset written with a separate name, as `a Done set of Items`. */
  readonly qualifiedRepair?: string;
}

function multiplicityOf(structural: string | undefined): SsfMultiplicity | undefined {
  if (structural === "seq") return "sequence";
  if (structural === "set" || structural === "element") return structural;
  return structural === undefined ? undefined : NEAR_MISS_STRUCTURAL.get(structural);
}

/** A lowercase subset or parent name written apart from the type, as `done` in `a done set of Items`. */
function isSeparateSubsetName(text: string | undefined): text is string {
  return text !== undefined && FIELD_NAME.test(text) && !RESERVED_NAMES.has(text);
}

/** The index just past the run of capitalized words that starts at `start`. */
function phraseEnd(tokens: readonly SsfToken[], start: number): number {
  let end = start;
  while (end < tokens.length && TYPE_NAME.test(tokens[end]!.text)) end += 1;
  return end;
}

function phraseReference(tokens: readonly SsfToken[], start: number, end: number): ParsedReference {
  const phrase = tokens.slice(start, end);
  return {
    text: phrase.map(({ text }) => text).join(" "),
    span: span(phrase[0]!.span.start, phrase.at(-1)!.span.end),
    wordSpans: phrase.map(({ span: wordSpan }) => wordSpan),
  };
}

/** Parse an optional `where field is VALUE (or VALUE)*`; undefined when it is malformed. */
function parseCondition(
  line: SourceLine,
  start: number,
): { readonly condition?: ParsedSubsetCondition; readonly next: number } | undefined {
  const authored = words(line);
  if (authored[start] !== "where") return { next: start };
  const where = line.tokens[start]!;
  const field = line.tokens[start + 1];
  if (field === undefined || !FIELD_NAME.test(field.text) || authored[start + 2] !== "is")
    return undefined;
  const values: ParsedReference[] = [];
  let cursor = start + 3;
  for (; cursor < line.tokens.length; cursor += 1) {
    const token = line.tokens[cursor]!;
    if ((cursor - start - 3) % 2 === 0) {
      if (!ENUM_VALUE.test(token.text)) break;
      values.push({ text: token.text, span: token.span });
    } else if (token.text !== "or") break;
  }
  const last = values.at(-1);
  if (last === undefined || cursor - start - 3 !== values.length * 2 - 1) return undefined;
  return {
    condition: {
      field: { text: field.text, span: field.span },
      values,
      span: span(where.span.start, last.span.end),
    },
    next: cursor,
  };
}

function capitalized(word: string): string {
  return `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`;
}

/**
 * Parse `(a|an) (set|seq|element) [of] Name… [where …] [with]`. One capitalized word names a
 * top-level declaration; more name a subset of the set the words after the first one name.
 * A subset written with a separate name, `a Done set of Items` or `a done set of Items`,
 * parses as the qualified subset it describes and carries that spelling as its repair.
 */
function parseDeclaration(line: SourceLine): ParsingDeclaration | undefined {
  const authored = words(line);
  const tokens = line.tokens;
  let first = 0;
  if (authored[first] === "a" || authored[first] === "an") first += 1;
  const topMultiplicity = multiplicityOf(authored[first]);
  let multiplicity: SsfMultiplicity;
  let structuralIndex: number;
  let name: ParsedReference;
  let nameEnd: number;
  let qualifiedWords: readonly string[] | undefined;

  if (topMultiplicity !== undefined) {
    multiplicity = topMultiplicity;
    structuralIndex = first;
    const nameStart = first + 1 + (authored[first + 1] === "of" ? 1 : 0);
    nameEnd = phraseEnd(tokens, nameStart);
    if (nameEnd === nameStart) return undefined;
    name = phraseReference(tokens, nameStart, nameEnd);
  } else {
    const separateMultiplicity = multiplicityOf(authored[first + 1]);
    const subsetName = authored[first];
    if (
      separateMultiplicity === undefined ||
      separateMultiplicity === "sequence" ||
      subsetName === undefined ||
      !(TYPE_NAME.test(subsetName) || isSeparateSubsetName(subsetName))
    )
      return undefined;
    multiplicity = separateMultiplicity;
    structuralIndex = first + 1;
    let cursor = structuralIndex + 1 + (authored[structuralIndex + 1] === "of" ? 1 : 0);
    const parentIndex = isSeparateSubsetName(authored[cursor]) ? cursor++ : undefined;
    nameEnd = phraseEnd(tokens, cursor);
    if (nameEnd === cursor) return undefined;
    const wordTokens = [
      tokens[first]!,
      ...(parentIndex === undefined ? [] : [tokens[parentIndex]!]),
      ...tokens.slice(cursor, nameEnd),
    ];
    qualifiedWords = wordTokens.map(({ text }) => capitalized(text));
    name = {
      text: qualifiedWords.join(" "),
      span: span(tokens[first]!.span.start, tokens[nameEnd - 1]!.span.end),
      wordSpans: wordTokens.map(({ span: wordSpan }) => wordSpan),
    };
  }

  const declarationKind = name.text.includes(" ") ? "subset" : "collection";
  const parsedCondition = parseCondition(line, nameEnd);
  if (parsedCondition === undefined) return undefined;
  const { condition, next: trailing } = parsedCondition;
  if (condition !== undefined && declarationKind === "collection") return undefined;
  const hasWith = authored[trailing] === "with";
  if (authored.length > trailing + (hasWith ? 1 : 0)) return undefined;

  const qualifiedRepair =
    qualifiedWords === undefined
      ? undefined
      : [
          multiplicity === "element" ? "an element" : "a set of",
          ...qualifiedWords,
          ...authored.slice(nameEnd, trailing),
          ...(hasWith ? ["with"] : []),
        ].join(" ");
  return {
    name,
    declarationKind,
    multiplicity,
    ...(condition === undefined ? {} : { condition }),
    fields: [],
    constraints: [],
    rules: [],
    span: lineSpan(line),
    signatureSpan: lineSpan(line),
    signature: line,
    structuralIndex,
    authoredStructural: authored[structuralIndex]!,
    hasWith,
    hasMalformedField: false,
    hasRepairableField: false,
    ...(qualifiedRepair === undefined ? {} : { qualifiedRepair }),
  };
}

function parseAlias(line: SourceLine): ParsedAlias | undefined {
  const tokens = line.tokens;
  if (
    tokens.length !== 4 ||
    tokens[0]?.text !== "alias" ||
    !TYPE_NAME.test(tokens[1]?.text ?? "") ||
    tokens[2]?.text !== "for" ||
    !TYPE_NAME.test(tokens[3]?.text ?? "")
  )
    return undefined;
  return {
    name: { text: tokens[1].text, span: tokens[1].span },
    target: { text: tokens[3].text, span: tokens[3].span },
    span: lineSpan(line),
  };
}

/** A named value: one capitalized word for a type, or several for a subset such as `Verified User`. */
function namedType(tokens: readonly SsfToken[]): ParsedNamed | undefined {
  return tokens.length > 0 && phraseEnd(tokens, 0) === tokens.length
    ? { kind: "named", reference: phraseReference(tokens, 0, tokens.length) }
    : undefined;
}

const FIELD_MODIFIERS = ["optional", "unique"] as const;
const RESERVED_FIELD_NAMES: ReadonlySet<string> = new Set([...FIELD_MODIFIERS, "set", "seq"]);

type FieldModifier = (typeof FIELD_MODIFIERS)[number];

function fieldModifier(text: string | undefined): FieldModifier | undefined {
  return FIELD_MODIFIERS.find((modifier) => modifier === text);
}

/** Index of each authored modifier token, ignoring a leading article. */
function modifierIndexes(authored: readonly SsfToken[], article: number): readonly number[] {
  return authored.flatMap((token, index) =>
    index >= article && fieldModifier(token.text) !== undefined ? [index] : [],
  );
}

function articleLength(authored: readonly SsfToken[]): number {
  return authored[0]?.text === "a" || authored[0]?.text === "an" ? 1 : 0;
}

/**
 * Parse a field's tokens: an optional article, its modifiers, an optional name, and a
 * named value. A field written without a name takes the one its value's type implies.
 */
function parseFieldTokens(authored: readonly SsfToken[]): Omit<ParsedField, "span"> | undefined {
  const article = articleLength(authored);
  const indexes = modifierIndexes(authored, article);
  const modifiers = new Set(indexes.map((index) => fieldModifier(authored[index]!.text)!));
  if (modifiers.size !== indexes.length) return undefined;
  const tokens = authored.filter((_, index) => index >= article && !indexes.includes(index));
  const first = tokens[0];
  if (first === undefined) return undefined;
  const implicitName = first.text === "set" || first.text === "seq" || TYPE_NAME.test(first.text);
  if (!implicitName && !FIELD_NAME.test(first.text)) return undefined;
  const valueTokens = implicitName ? tokens : tokens.slice(1);

  let value: ParsedFieldType | undefined;
  const structural = valueTokens[0]?.text;
  if (structural === "set" || structural === "seq") {
    let elementStart = 1;
    if (valueTokens[elementStart]?.text === "of") elementStart += 1;
    const element = namedType(valueTokens.slice(elementStart));
    if (element !== undefined)
      value = {
        kind: "collection",
        multiplicity: structural === "set" ? "set" : "sequence",
        element,
        span: span(valueTokens[0]!.span.start, valueTokens.at(-1)!.span.end),
      };
  } else {
    value = namedType(valueTokens);
  }
  if (value === undefined) return undefined;
  const typeName = value.kind === "named" ? value.reference : value.element.reference;
  const name = implicitName ? impliedName(typeName.text) : first.text;
  if (RESERVED_FIELD_NAMES.has(name)) return undefined;
  return {
    name,
    nameSpan: implicitName ? typeName.span : first.span,
    implicitName,
    optional: modifiers.has("optional"),
    unique: modifiers.has("unique"),
    value,
  };
}

/**
 * Diagnose a field left unnamed whose type implies a reserved name, as `a Set` implies
 * `set`, and repair it with a written name no other field of its declaration takes.
 */
function reservedNameDiagnostic(
  line: SourceLine,
  takenNames: ReadonlySet<string>,
): SsfDiagnostic | undefined {
  const tokens = line.tokens;
  let start = articleLength(tokens);
  while (fieldModifier(tokens[start]?.text) !== undefined) start += 1;
  const first = tokens[start];
  if (first === undefined) return undefined;
  const named = (name: string): readonly SsfToken[] => [
    ...tokens.slice(0, start),
    { ...first, text: name },
    ...tokens.slice(start),
  ];
  const probe = parseFieldTokens(named("value"));
  if (probe === undefined) return undefined;
  const implied = impliedName(
    probe.value.kind === "named" ? probe.value.reference.text : probe.value.element.reference.text,
  );
  if (!RESERVED_FIELD_NAMES.has(implied)) return undefined;
  let name = `${implied}Value`;
  for (let suffix = 2; takenNames.has(name); suffix += 1) name = `${implied}Value${suffix}`;
  let repaired = named(name);
  let field = parseFieldTokens(repaired);
  // A collection is never optional, so the repair drops `optional` from one.
  if (fieldViolation(field) === "optional-collection") {
    repaired = repaired.filter(({ text }) => text !== "optional");
    field = parseFieldTokens(repaired);
  }
  if (field === undefined) return undefined;
  return error({
    code: "SSF_MALFORMED_FIELD",
    message: `Without a written name this field would be named \`${implied}\`, which the grammar reserves.`,
    suggestion: repairedLine(line, canonicalFieldTokens(repaired, field)),
    span: first.span,
  });
}

function parseField(line: SourceLine): ParsedField | undefined {
  const parsed = parseFieldTokens(line.tokens);
  return parsed === undefined ? undefined : { ...parsed, span: lineSpan(line) };
}

/** Parse `unique fieldName (and fieldName)*`; the field modifier is shorthand for one name. */
function parseUniqueConstraint(line: SourceLine): ParsedUniqueConstraint | undefined {
  const tokens = line.tokens;
  if (tokens[0]?.text !== "unique") return undefined;
  const fields: ParsedReference[] = [];
  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (index % 2 === 1) {
      if (!FIELD_NAME.test(token.text)) return undefined;
      fields.push({ text: token.text, span: token.span });
    } else if (token.text !== "and") return undefined;
  }
  if (fields.length === 0 || tokens.length !== fields.length * 2) return undefined;
  return { fields, span: lineSpan(line) };
}

function ruleMarker(line: SourceLine): string | undefined {
  if (line.tokens.length < 2) return undefined;
  const first = line.tokens[0]?.text;
  if (first === RULE_MARKER) return RULE_MARKER;
  return NEAR_MISS_RULE_MARKERS.find((marker) => marker === first);
}

function nearMissRuleDiagnostic(line: SourceLine, marker: string): SsfDiagnostic {
  const markerToken = line.tokens[0];
  const markerStart = (markerToken?.span.start.offset ?? line.start) - line.start;
  const markerEnd = (markerToken?.span.end.offset ?? line.start) - line.start;
  return error({
    code: "SSF_NEAR_MISS_KEYWORD",
    message: `Use the exact SSF prose marker \`${RULE_MARKER}\` instead of \`${marker}\`.`,
    suggestion: `${line.text.slice(0, markerStart)}${RULE_MARKER}${line.text.slice(markerEnd)}`,
    span: markerToken?.span ?? lineSpan(line),
  });
}

function orphanedLineDiagnostic(
  line: SourceLine,
  marker?: string,
  body: "field" | "uniqueness constraint" = "field",
): SsfDiagnostic {
  const nearMiss = marker !== undefined && marker !== RULE_MARKER;
  const subject = marker === undefined ? `valid SSF ${body}` : `indented \`${marker}\` line`;
  return error({
    code: "SSF_ORPHANED_LINE",
    message: `This ${subject} has no enclosing SSF declaration${nearMiss ? ` and does not use the exact \`${RULE_MARKER}\` marker` : ""}.`,
    suggestion:
      marker === undefined
        ? `Add an enclosing declaration ending in \`with\` before this ${body}.`
        : nearMiss
          ? `Add an enclosing declaration and use \`${RULE_MARKER}\`; or unindent the corrected line to make it a top-level rule.`
          : "Add an enclosing declaration before this line, or remove its indentation to make it a top-level rule.",
    span: lineSpan(line),
  });
}

function malformedLineDiagnostic(
  line: SourceLine,
  kind: "alias" | "declaration" | "field",
): SsfDiagnostic {
  if (kind === "alias")
    return error({
      code: "SSF_MALFORMED_ALIAS",
      message: "This top-level line is not a complete SSF alias.",
      suggestion: "Use exactly `alias Name for Target` with uppercase SSF type names.",
      span: lineSpan(line),
    });
  const field = kind === "field";
  return error({
    code: field ? "SSF_MALFORMED_FIELD" : "SSF_MALFORMED_DECLARATION",
    message: `This ${field ? "indented" : "top-level"} line is not ${field ? "an SSF field, uniqueness constraint, or" : "an SSF declaration, alias, or"} \`${RULE_MARKER}\` line.`,
    suggestion: field
      ? `Use a complete field, a \`unique fieldName (and fieldName)*\` constraint, or prefix prose with the exact \`${RULE_MARKER}\` marker.`
      : `Use a complete declaration or alias, or prefix prose with the exact \`${RULE_MARKER}\` marker.`,
    span: lineSpan(line),
  });
}

function correctedTokens(
  tokens: readonly SsfToken[],
  replacements: ReadonlyMap<number, string>,
): string {
  return tokens.map(({ text }, index) => replacements.get(index) ?? text).join(" ");
}

function articleFor(structural: SsfMultiplicity): "a" | "an" {
  return structural === "element" ? "an" : "a";
}

function canonicalStructural(structural: SsfMultiplicity): "element" | "seq" | "set" {
  return structural === "sequence" ? "seq" : structural;
}

function declarationDiagnostics(declaration: ParsingDeclaration): SsfDiagnostic[] {
  const diagnostics: SsfDiagnostic[] = [];
  const hasFields = declaration.fields.length > 0 || declaration.hasRepairableField;
  const hasBody = hasFields || declaration.constraints.length > 0;
  const tokens = declaration.signature.tokens;
  const authored = words(declaration.signature);
  // A subset uses `set` or `element`, so a sequence keyword on one is repaired to `set`.
  const subsetSequence =
    declaration.declarationKind === "subset" && declaration.multiplicity === "sequence";
  const canonical = subsetSequence ? "set" : canonicalStructural(declaration.multiplicity);
  const replacements = new Map<number, string>();
  if (declaration.authoredStructural !== canonical)
    replacements.set(declaration.structuralIndex, canonical);
  const hasArticle = declaration.structuralIndex === 1;
  if (hasArticle) replacements.set(0, articleFor(declaration.multiplicity));
  const withSuffix = hasBody && !declaration.hasWith ? " with" : "";
  const canonicalLine =
    declaration.qualifiedRepair === undefined
      ? `${correctedTokens(tokens, replacements)}${withSuffix}`
      : `${declaration.qualifiedRepair}${withSuffix}`;
  const structuralToken = tokens[declaration.structuralIndex];

  if (declaration.qualifiedRepair !== undefined) {
    diagnostics.push(
      error({
        code: "SSF_MALFORMED_DECLARATION",
        message:
          "Name a subset by qualifying its parent set, as in `a set of Verified Users`, rather than with a separate subset name.",
        suggestion: canonicalLine,
        span: declaration.name.span,
      }),
    );
  } else if (declaration.structuralIndex === 0) {
    diagnostics.push(
      error({
        code: "SSF_ARTICLE",
        message: `Use \`${articleFor(declaration.multiplicity)}\` before \`${canonical}\`.`,
        suggestion: `${articleFor(declaration.multiplicity)} ${canonicalLine}`,
        span: structuralToken?.span ?? declaration.signatureSpan,
      }),
    );
  } else if (
    declaration.authoredStructural !== canonical &&
    !subsetSequence &&
    structuralToken !== undefined
  ) {
    diagnostics.push(
      error({
        code: "SSF_NEAR_MISS_KEYWORD",
        message: `Use the SSF keyword \`${canonical}\` instead of \`${declaration.authoredStructural}\`.`,
        suggestion: canonicalLine,
        span: structuralToken.span,
      }),
    );
  } else {
    const expected = articleFor(declaration.multiplicity);
    const article = authored[0];
    if ((article === "a" || article === "an") && article !== expected && tokens[0] !== undefined) {
      diagnostics.push(
        error({
          code: "SSF_ARTICLE",
          message: `Use \`${expected}\` before \`${canonical}\`.`,
          suggestion: canonicalLine,
          span: tokens[0].span,
        }),
      );
    }
  }
  if (subsetSequence && structuralToken !== undefined) {
    diagnostics.push(
      error({
        code: "SSF_MALFORMED_DECLARATION",
        message: "A subset uses `set` or `element`; its parent set already fixes any order.",
        suggestion: hasArticle ? canonicalLine : `a ${canonicalLine}`,
        span: structuralToken.span,
      }),
    );
  }
  if (declaration.hasWith && !hasBody && !declaration.hasMalformedField) {
    diagnostics.push(
      error({
        code: "SSF_MALFORMED_DECLARATION",
        message:
          "A declaration ending in `with` must have at least one indented field or constraint.",
        suggestion: "Remove `with` or add an indented field or uniqueness constraint.",
        span: tokens.at(-1)?.span ?? declaration.signatureSpan,
      }),
    );
  }
  if (hasBody && !declaration.hasWith) {
    const end = declaration.signatureSpan.end;
    diagnostics.push(
      error({
        code: "SSF_MISSING_WITH",
        message: "A declaration with an indented body must include `with`.",
        suggestion: canonicalLine,
        span: span(end, end),
      }),
    );
  }
  return diagnostics;
}

/** Render a repaired field line under its authored indentation. */
function repairedLine(line: SourceLine, tokens: readonly SsfToken[]): string {
  const indentation = line.text.slice(
    0,
    (line.tokens[0]?.span.start.offset ?? line.start) - line.start,
  );
  return `${indentation}${tokens.map(({ text }) => text).join(" ")}`;
}

/** Order a field's tokens canonically: the article, then its modifiers, then the rest. */
function canonicalFieldTokens(
  tokens: readonly SsfToken[],
  field: Omit<ParsedField, "span">,
): readonly SsfToken[] {
  const article = articleLength(tokens);
  const indexes = modifierIndexes(tokens, article);
  return [
    ...tokens.slice(0, article),
    ...FIELD_MODIFIERS.filter((modifier) => field[modifier]).map((modifier) => ({
      ...tokens[indexes[0]!]!,
      text: modifier,
    })),
    ...tokens.filter((_, index) => index >= article && !indexes.includes(index)),
  ];
}

/** The notation's own rule on a field the grammar accepts: a collection is never optional. */
function fieldViolation(
  field: Omit<ParsedField, "span"> | undefined,
): "optional-collection" | undefined {
  return field?.optional === true && field.value.kind === "collection"
    ? "optional-collection"
    : undefined;
}

/** Diagnose a parsed field whose modifiers the grammar accepts but the notation does not. */
function fieldDiagnostic(line: SourceLine, field: ParsedField): SsfDiagnostic | undefined {
  const tokens = line.tokens;
  const article = articleLength(tokens);
  const indexes = modifierIndexes(tokens, article);
  if (fieldViolation(field) === "optional-collection")
    return error({
      code: "SSF_OPTIONAL_COLLECTION",
      message: "SSF collections are never optional; an empty collection represents absence.",
      suggestion: "Remove `optional` from this field.",
      span: tokens[indexes.find((index) => tokens[index]!.text === "optional")!]!.span,
    });
  const misplaced = indexes.find((index, position) => index !== article + position);
  if (misplaced === undefined) return undefined;
  return error({
    code: "SSF_MISPLACED_MODIFIER",
    message: `The \`${tokens[misplaced]!.text}\` modifier must come before the field name.`,
    suggestion: repairedLine(line, canonicalFieldTokens(tokens, field)),
    span: tokens[misplaced]!.span,
  });
}

export function parseGrammar(lines: readonly SourceLine[]): GrammarResult {
  const declarations: ParsingDeclaration[] = [];
  const aliases: ParsedAlias[] = [];
  const rules: SsfRuleLine[] = [];
  const diagnostics: SsfDiagnostic[] = [];
  const unparsedFields: { readonly line: SourceLine; readonly declaration: ParsingDeclaration }[] =
    [];
  let current: ParsingDeclaration | undefined;

  for (const line of lines) {
    if (line.text.trim() === "") continue;
    const indented = (line.tokens[0]?.span.start.offset ?? line.end) > line.start;
    const marker = ruleMarker(line);
    if (marker !== undefined) {
      if (indented) {
        if (current === undefined) diagnostics.push(orphanedLineDiagnostic(line, marker));
        else {
          if (marker === RULE_MARKER) current.rules.push(ruleLine(line));
          else diagnostics.push(nearMissRuleDiagnostic(line, marker));
          current.span = span(current.span.start, lineSpan(line).end);
        }
      } else {
        current = undefined;
        if (marker === RULE_MARKER) rules.push(ruleLine(line));
        else diagnostics.push(nearMissRuleDiagnostic(line, marker));
      }
      continue;
    }
    if (indented) {
      const field = parseField(line);
      const constraint = field === undefined ? parseUniqueConstraint(line) : undefined;
      if (field !== undefined) {
        if (current === undefined) diagnostics.push(orphanedLineDiagnostic(line));
        else {
          current.fields.push(field);
          const diagnostic = fieldDiagnostic(line, field);
          if (diagnostic !== undefined) diagnostics.push(diagnostic);
        }
      } else if (constraint !== undefined) {
        if (current === undefined)
          diagnostics.push(orphanedLineDiagnostic(line, undefined, "uniqueness constraint"));
        else current.constraints.push(constraint);
      } else {
        if (current === undefined)
          diagnostics.push(
            reservedNameDiagnostic(line, new Set()) ?? malformedLineDiagnostic(line, "field"),
          );
        else unparsedFields.push({ line, declaration: current });
        if (current !== undefined) current.hasMalformedField = true;
      }
      if (current !== undefined) current.span = span(current.span.start, lineSpan(line).end);
      continue;
    }

    current = undefined;
    const alias = parseAlias(line);
    if (alias !== undefined) {
      aliases.push(alias);
      continue;
    }
    const declaration = parseDeclaration(line);
    if (declaration === undefined) {
      diagnostics.push(
        malformedLineDiagnostic(line, line.tokens[0]?.text === "alias" ? "alias" : "declaration"),
      );
      continue;
    }
    declarations.push(declaration);
    current = declaration;
  }

  // A reserved-name repair picks a name only once its declaration's fields are all known.
  for (const { line, declaration } of unparsedFields) {
    const reserved = reservedNameDiagnostic(
      line,
      new Set(declaration.fields.map(({ name }) => name)),
    );
    if (reserved !== undefined) declaration.hasRepairableField = true;
    diagnostics.push(reserved ?? malformedLineDiagnostic(line, "field"));
  }
  for (const declaration of declarations) diagnostics.push(...declarationDiagnostics(declaration));
  return { declarations, aliases, rules, diagnostics };
}
