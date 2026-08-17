export interface SsfPosition {
  /** Zero-based UTF-16 offset in the supplied State text. */
  readonly offset: number;
  /** One-based line in the supplied State text. */
  readonly line: number;
  /** One-based column in the supplied State text. */
  readonly column: number;
}

export interface SsfSpan {
  readonly start: SsfPosition;
  readonly end: SsfPosition;
}

export type SsfTokenKind = "newline" | "whitespace" | "word";

export interface SsfToken {
  readonly kind: SsfTokenKind;
  readonly text: string;
  readonly span: SsfSpan;
}

export type SsfDiagnosticCode =
  | "SSF_ARTICLE"
  | "SSF_MISPLACED_OPTIONAL"
  | "SSF_MISSING_WITH"
  | "SSF_NEAR_MISS_KEYWORD"
  | "SSF_OPTIONAL_COLLECTION";

export interface SsfDiagnostic {
  readonly code: SsfDiagnosticCode;
  readonly message: string;
  readonly suggestion: string;
  readonly span: SsfSpan;
}

export interface SsfTypeName {
  /** Spelling retained from the State text. */
  readonly text: string;
  /** Stable singular equivalence key used for declaration and reference joins. */
  readonly normalized: string;
}

export type SsfReferenceKind = "external" | "owned" | "primitive" | "unresolved";

export interface SsfTypeReference extends SsfTypeName {
  readonly referenceKind: SsfReferenceKind;
  readonly span: SsfSpan;
}

export interface SsfNamedFieldType {
  readonly kind: "named";
  readonly reference: SsfTypeReference;
}

export interface SsfEnumerationFieldType {
  readonly kind: "enumeration";
  readonly values: readonly string[];
  readonly span: SsfSpan;
}

export interface SsfCollectionFieldType {
  readonly kind: "collection";
  readonly multiplicity: "set" | "sequence";
  readonly element: SsfNamedFieldType | SsfEnumerationFieldType;
  readonly span: SsfSpan;
}

export type SsfFieldType = SsfNamedFieldType | SsfEnumerationFieldType | SsfCollectionFieldType;

export interface SsfField {
  readonly kind: "field";
  readonly name: string;
  readonly inferredName: boolean;
  readonly optional: boolean;
  readonly value: SsfFieldType;
  readonly span: SsfSpan;
}

export type SsfMultiplicity = "element" | "sequence" | "set";

export interface SsfOpaqueLine {
  readonly kind: "opaque";
  readonly text: string;
  readonly span: SsfSpan;
}

export interface SsfDeclaration {
  readonly kind: "declaration";
  /** The introduced or referenced set/type name. */
  readonly name: SsfTypeReference;
  readonly declarationKind: "collection" | "subset";
  readonly multiplicity: SsfMultiplicity;
  /** Present only on subset declarations. */
  readonly parent?: SsfTypeReference;
  readonly fields: readonly SsfField[];
  /** Indented lines outside the bounded structural grammar are retained losslessly. */
  readonly opaqueBody: readonly SsfOpaqueLine[];
  readonly span: SsfSpan;
  readonly signatureSpan: SsfSpan;
}

export type SsfStatement = SsfDeclaration | SsfOpaqueLine;

export interface SsfOwnedType {
  /** Canonical singular name used for equality. */
  readonly name: string;
  /** Every authored spelling that introduced this type. */
  readonly declaredNames: readonly string[];
  readonly roles: readonly ("identity" | "subset")[];
  readonly declarationSpans: readonly SsfSpan[];
}

export interface SsfTypeInventory {
  /** Definition-owned identities introduced by top-level set, sequence, or element declarations. */
  readonly identities: readonly SsfOwnedType[];
  /** All definition-owned binding targets, including subset names. */
  readonly types: readonly SsfOwnedType[];
  readonly external: readonly string[];
  readonly primitives: readonly string[];
}

export interface SsfDocument {
  readonly statements: readonly SsfStatement[];
  readonly declarations: readonly SsfDeclaration[];
  readonly opaqueLines: readonly SsfOpaqueLine[];
  readonly inventory: SsfTypeInventory;
}

export interface SsfParseOptions {
  /** Opaque parameter names declared by the containing concept specification. */
  readonly externalTypes?: readonly string[];
}

export interface SsfParseResult {
  readonly document: SsfDocument;
  readonly diagnostics: readonly SsfDiagnostic[];
}

interface SourceLine {
  readonly text: string;
  readonly line: number;
  readonly start: number;
  readonly end: number;
  readonly tokens: readonly SsfToken[];
}

interface ParsedReference {
  readonly text: string;
  readonly span: SsfSpan;
}

interface ParsedNamedFieldType {
  readonly kind: "named";
  readonly reference: ParsedReference;
}

interface ParsedEnumerationFieldType {
  readonly kind: "enumeration";
  readonly values: readonly string[];
  readonly span: SsfSpan;
}

interface ParsedCollectionFieldType {
  readonly kind: "collection";
  readonly multiplicity: "set" | "sequence";
  readonly element: ParsedNamedFieldType | ParsedEnumerationFieldType;
  readonly span: SsfSpan;
}

type ParsedFieldType =
  | ParsedNamedFieldType
  | ParsedEnumerationFieldType
  | ParsedCollectionFieldType;

interface ParsedField {
  readonly name: string;
  readonly inferredName: boolean;
  readonly optional: boolean;
  readonly value: ParsedFieldType;
  readonly span: SsfSpan;
}

interface ParsedDeclaration {
  readonly name: ParsedReference;
  readonly declarationKind: "collection" | "subset";
  readonly multiplicity: SsfMultiplicity;
  readonly parent?: ParsedReference;
  readonly fields: ParsedField[];
  readonly opaqueBody: SsfOpaqueLine[];
  span: SsfSpan;
  readonly signatureSpan: SsfSpan;
  readonly signature: SourceLine;
  readonly structuralIndex: number;
  readonly authoredStructural: string;
  readonly hasWith: boolean;
}

const TYPE_NAME = /^[A-Z][A-Za-z0-9_]*$/;
const SINGULAR_EXCEPTIONS = new Map<string, string>([
  ["Alias", "Alias"],
  ["Aliases", "Alias"],
  ["Analyses", "Analysis"],
  ["Children", "Child"],
  ["Indices", "Index"],
  ["Matrices", "Matrix"],
  ["News", "News"],
  ["People", "Person"],
  ["Series", "Series"],
  ["Species", "Species"],
  ["Statuses", "Status"],
  ["Women", "Woman"],
]);
const FIELD_NAME = /^[a-z][A-Za-z0-9_]*$/;
const ENUM_VALUE = /^[A-Z][A-Z0-9_]*$/;
const PRIMITIVES = ["Date", "DateTime", "Flag", "Number", "String"] as const;
const PRIMITIVE_KEYS = new Set(PRIMITIVES.map((name) => normalizeTypeName(name)));
const CANONICAL_STRUCTURAL = new Set(["element", "seq", "set"]);
const NEAR_MISS_STRUCTURAL = new Map<string, SsfMultiplicity>([
  ["array", "sequence"],
  ["list", "sequence"],
  ["sequence", "sequence"],
  ["sequences", "sequence"],
  ["singleton", "element"],
]);

function position(offset: number, line: number, column: number): SsfPosition {
  return { offset, line, column };
}

function span(start: SsfPosition, end: SsfPosition): SsfSpan {
  return { start, end };
}

/** Tokenize all State text without discarding whitespace or source ranges. */
export function tokenizeSimpleStateForm(source: string): readonly SsfToken[] {
  const tokens: SsfToken[] = [];
  let offset = 0;
  let line = 1;
  let column = 1;
  while (offset < source.length) {
    const start = position(offset, line, column);
    const character = source[offset] ?? "";
    if (character === "\r" || character === "\n") {
      const length = character === "\r" && source[offset + 1] === "\n" ? 2 : 1;
      tokens.push({
        kind: "newline",
        text: source.slice(offset, offset + length),
        span: span(start, position(offset + length, line + 1, 1)),
      });
      offset += length;
      line += 1;
      column = 1;
      continue;
    }
    const whitespace = character === " " || character === "\t";
    let end = offset + 1;
    while (end < source.length) {
      const candidate = source[end] ?? "";
      if (candidate === "\r" || candidate === "\n") break;
      if ((candidate === " " || candidate === "\t") !== whitespace) break;
      end += 1;
    }
    tokens.push({
      kind: whitespace ? "whitespace" : "word",
      text: source.slice(offset, end),
      span: span(start, position(end, line, column + end - offset)),
    });
    column += end - offset;
    offset = end;
  }
  return tokens;
}

/**
 * Normalize the documented singular/plural equivalence to one lexical key.
 * The ordered suffix rules cover regular English plurals without changing
 * singular names ending in `ss`, `us`, or `is`.
 */
export function normalizeTypeName(name: string): string {
  if (!TYPE_NAME.test(name)) return name;
  const exceptional = SINGULAR_EXCEPTIONS.get(name);
  if (exceptional !== undefined) return exceptional;
  if (/[^AEIOU]ies$/.test(name)) return `${name.slice(0, -3)}y`;
  if (/(?:ches|shes|sses|xes|zes)$/.test(name)) return name.slice(0, -2);
  if (name.endsWith("s") && !/(?:ss|us|is)$/.test(name)) return name.slice(0, -1);
  return name;
}

export function typeNamesEquivalent(left: string, right: string): boolean {
  return normalizeTypeName(left) === normalizeTypeName(right);
}

/** Test an authored spelling against the normalized definition-owned inventory. */
export function isOwnedTypeName(inventory: SsfTypeInventory, name: string): boolean {
  const normalized = normalizeTypeName(name);
  return inventory.types.some((owned) => owned.name === normalized);
}

/**
 * Enumerate every identifier spelling accepted by the shared singular/plural
 * normalizer for the definition-owned inventory. This is the list-valued adapter
 * used by sync-engine's authored-instance validation seam.
 */
export function ownedTypeNameSpellings(inventory: SsfTypeInventory): readonly string[] {
  const names = new Set<string>();
  for (const owned of inventory.types) {
    names.add(owned.name);
    for (const declared of owned.declaredNames) names.add(declared);
    for (const [spelling, normalized] of SINGULAR_EXCEPTIONS) {
      if (normalized === owned.name) names.add(spelling);
    }
    const regularPlural = pluralizeNormalizedTypeName(owned.name);
    if (normalizeTypeName(regularPlural) === owned.name) names.add(regularPlural);
  }
  return [...names].sort();
}

function pluralizeNormalizedTypeName(name: string): string {
  if (/[^AEIOU]y$/.test(name)) return `${name.slice(0, -1)}ies`;
  if (/(?:ch|sh|ss|x|z|us)$/.test(name)) return `${name}es`;
  return `${name}s`;
}

function implicitFieldName(type: string, collection: boolean): string {
  const normalized = normalizeTypeName(type);
  const authored = collection ? pluralizeNormalizedTypeName(normalized) : normalized;
  return `${authored[0]?.toLowerCase() ?? ""}${authored.slice(1)}`;
}

function sourceLines(source: string, tokens: readonly SsfToken[]): readonly SourceLine[] {
  const lines: SourceLine[] = [];
  let start = 0;
  let number = 1;
  for (const token of tokens) {
    if (token.kind !== "newline") continue;
    const end = token.span.start.offset;
    lines.push({
      text: source.slice(start, end),
      line: number,
      start,
      end,
      tokens: tokens.filter(
        (candidate) =>
          candidate.kind === "word" &&
          candidate.span.start.offset >= start &&
          candidate.span.end.offset <= end,
      ),
    });
    start = token.span.end.offset;
    number += 1;
  }
  if (start < source.length || source.length === 0 || tokens.at(-1)?.kind !== "newline") {
    lines.push({
      text: source.slice(start),
      line: number,
      start,
      end: source.length,
      tokens: tokens.filter(
        (candidate) => candidate.kind === "word" && candidate.span.start.offset >= start,
      ),
    });
  }
  return lines;
}

function lineSpan(line: SourceLine): SsfSpan {
  return span(
    position(line.start, line.line, 1),
    position(line.end, line.line, line.text.length + 1),
  );
}

function opaqueLine(line: SourceLine): SsfOpaqueLine {
  return { kind: "opaque", text: line.text, span: lineSpan(line) };
}

function words(line: SourceLine): readonly string[] {
  return line.tokens.map(({ text }) => text);
}

function multiplicityOf(structural: string): SsfMultiplicity | undefined {
  if (structural === "seq") return "sequence";
  if (structural === "set" || structural === "element") return structural;
  return NEAR_MISS_STRUCTURAL.get(structural);
}

function parseDeclaration(line: SourceLine): ParsedDeclaration | undefined {
  if (/^[ \t]/.test(line.text)) return undefined;
  const authored = words(line);
  let first = 0;
  if (authored[first] === "a" || authored[first] === "an") first += 1;
  const topStructural = authored[first];
  const subsetStructural = authored[first + 1];
  let declarationKind: "collection" | "subset";
  let structuralIndex: number;
  let nameIndex: number;
  let parentIndex: number | undefined;

  if (
    topStructural !== undefined &&
    (CANONICAL_STRUCTURAL.has(topStructural) || NEAR_MISS_STRUCTURAL.has(topStructural))
  ) {
    declarationKind = "collection";
    structuralIndex = first;
    nameIndex = first + 1 + (authored[first + 1] === "of" ? 1 : 0);
  } else if (
    TYPE_NAME.test(authored[first] ?? "") &&
    subsetStructural !== undefined &&
    (CANONICAL_STRUCTURAL.has(subsetStructural) || NEAR_MISS_STRUCTURAL.has(subsetStructural))
  ) {
    declarationKind = "subset";
    structuralIndex = first + 1;
    nameIndex = first;
    parentIndex = structuralIndex + 1 + (authored[structuralIndex + 1] === "of" ? 1 : 0);
  } else {
    return undefined;
  }

  const structural = authored[structuralIndex] ?? "";
  const multiplicity = multiplicityOf(structural);
  if (multiplicity === undefined) return undefined;
  if (declarationKind === "subset" && multiplicity === "sequence") return undefined;
  const nameToken = line.tokens[nameIndex];
  const parentToken = parentIndex === undefined ? undefined : line.tokens[parentIndex];
  if (
    nameToken === undefined ||
    !TYPE_NAME.test(nameToken.text) ||
    (parentIndex !== undefined && (parentToken === undefined || !TYPE_NAME.test(parentToken.text)))
  ) {
    return undefined;
  }

  const consumed = parentIndex ?? nameIndex;
  const trailing = authored.slice(consumed + 1);
  const hasWith = trailing[0] === "with";
  if (trailing.length > 0 && !hasWith) return undefined;

  return {
    name: { text: nameToken.text, span: nameToken.span },
    declarationKind,
    multiplicity,
    ...(parentToken === undefined
      ? {}
      : { parent: { text: parentToken.text, span: parentToken.span } }),
    fields: [],
    opaqueBody: [],
    span: lineSpan(line),
    signatureSpan: lineSpan(line),
    signature: line,
    structuralIndex,
    authoredStructural: structural,
    hasWith,
  };
}

function enumeration(
  fieldTokens: readonly SsfToken[],
  start: number,
): ParsedEnumerationFieldType | undefined {
  if (fieldTokens[start]?.text !== "of") return undefined;
  const values: string[] = [];
  for (let index = start + 1; index < fieldTokens.length; index += 1) {
    const text = fieldTokens[index]?.text ?? "";
    if ((index - start) % 2 === 1) {
      if (!ENUM_VALUE.test(text)) return undefined;
      values.push(text);
    } else if (text !== "or") {
      return undefined;
    }
  }
  if (values.length < 2 || fieldTokens.length - start !== values.length * 2) return undefined;
  return {
    kind: "enumeration",
    values,
    span: span(
      fieldTokens[start].span.start,
      fieldTokens.at(-1)?.span.end ?? fieldTokens[start].span.end,
    ),
  };
}

function namedType(token: SsfToken | undefined): ParsedNamedFieldType | undefined {
  return token !== undefined && TYPE_NAME.test(token.text)
    ? { kind: "named", reference: { text: token.text, span: token.span } }
    : undefined;
}

function parseField(line: SourceLine): ParsedField | undefined {
  if (!/^[ \t]/.test(line.text)) return undefined;
  const original = [...line.tokens];
  let first = 0;
  if (original[first]?.text === "a" || original[first]?.text === "an") first += 1;
  const optionalIndex = original.findIndex(
    (token, index) => index >= first && token.text === "optional",
  );
  const tokens = original.filter((_, index) => index >= first && index !== optionalIndex);
  if (tokens.length === 0) return undefined;

  let name: string | undefined;
  let inferredName = false;
  let valueStart = 0;
  if (
    tokens[0]?.text !== "set" &&
    tokens[0]?.text !== "seq" &&
    FIELD_NAME.test(tokens[0]?.text ?? "")
  ) {
    name = tokens[0]?.text;
    valueStart = 1;
  }

  let value: ParsedFieldType | undefined;
  const structural = tokens[valueStart]?.text;
  if (structural === "set" || structural === "seq") {
    let elementStart = valueStart + 1;
    if (tokens[elementStart]?.text === "of") elementStart += 1;
    const element = enumeration(tokens, elementStart) ?? namedType(tokens[elementStart]);
    if (
      element !== undefined &&
      elementStart + (element.kind === "named" ? 1 : element.values.length * 2) === tokens.length
    ) {
      value = {
        kind: "collection",
        multiplicity: structural === "set" ? "set" : "sequence",
        element,
        span: span(
          tokens[valueStart].span.start,
          tokens.at(-1)?.span.end ?? tokens[valueStart].span.end,
        ),
      };
      if (name === undefined && element.kind === "named") {
        name = implicitFieldName(element.reference.text, true);
        inferredName = true;
      }
    }
  } else {
    value = enumeration(tokens, valueStart) ?? namedType(tokens[valueStart]);
    const consumed =
      value?.kind === "named" ? valueStart + 1 : value?.kind === "enumeration" ? tokens.length : -1;
    if (consumed !== tokens.length) value = undefined;
    if (name === undefined && value?.kind === "named") {
      name = implicitFieldName(value.reference.text, false);
      inferredName = true;
    }
  }
  if (name === undefined || value === undefined) return undefined;
  return {
    name,
    inferredName,
    optional: optionalIndex >= 0,
    value,
    span: lineSpan(line),
  };
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

function declarationDiagnostics(
  declaration: ParsedDeclaration,
  hasFieldLikeBody: boolean,
): SsfDiagnostic[] {
  const diagnostics: SsfDiagnostic[] = [];
  const tokens = declaration.signature.tokens;
  const authored = words(declaration.signature);
  const canonical = canonicalStructural(declaration.multiplicity);
  const replacements = new Map<number, string>();
  if (declaration.authoredStructural !== canonical) {
    replacements.set(declaration.structuralIndex, canonical);
  }
  if (declaration.structuralIndex === 1) replacements.set(0, articleFor(declaration.multiplicity));
  const canonicalLine = `${correctedTokens(tokens, replacements)}${
    hasFieldLikeBody && !declaration.hasWith ? " with" : ""
  }`;
  const structuralToken = tokens[declaration.structuralIndex];

  if (declaration.authoredStructural !== canonical && structuralToken !== undefined) {
    diagnostics.push({
      code: "SSF_NEAR_MISS_KEYWORD",
      message: `Use the SSF keyword \`${canonical}\` instead of \`${declaration.authoredStructural}\`.`,
      suggestion: canonicalLine,
      span: structuralToken.span,
    });
  } else if (declaration.structuralIndex === 1) {
    const expected = articleFor(declaration.multiplicity);
    const article = authored[0];
    if ((article === "a" || article === "an") && article !== expected && tokens[0] !== undefined) {
      diagnostics.push({
        code: "SSF_ARTICLE",
        message: `Use \`${expected}\` before \`${canonical}\`.`,
        suggestion: canonicalLine,
        span: tokens[0].span,
      });
    }
  }
  if (hasFieldLikeBody && !declaration.hasWith) {
    const end = declaration.signatureSpan.end;
    diagnostics.push({
      code: "SSF_MISSING_WITH",
      message: "A declaration with indented fields must include `with`.",
      suggestion: canonicalLine,
      span: span(end, end),
    });
  }
  return diagnostics;
}

function fieldDiagnostics(line: SourceLine): readonly SsfDiagnostic[] {
  if (!/^[ \t]/.test(line.text)) return [];
  const tokens = line.tokens;
  if (tokens[0]?.text !== "a" && tokens[0]?.text !== "an") return [];
  const optionalIndex = tokens.findIndex(({ text }) => text === "optional");
  if (optionalIndex < 0) return [];
  const collectionIndex = tokens.findIndex(
    ({ text }, index) => index > 0 && (text === "set" || text === "seq"),
  );
  const optionalToken = tokens[optionalIndex];
  if (optionalToken === undefined) return [];
  if (collectionIndex >= 0) {
    return [
      {
        code: "SSF_OPTIONAL_COLLECTION",
        message: "SSF collections are never optional; an empty collection represents absence.",
        suggestion: "Remove `optional` from this field.",
        span: optionalToken.span,
      },
    ];
  }
  if (optionalIndex !== 1) {
    const withoutOptional = tokens
      .filter((_, index) => index !== optionalIndex)
      .map(({ text }) => text);
    withoutOptional[0] = "an";
    withoutOptional.splice(1, 0, "optional");
    return [
      {
        code: "SSF_MISPLACED_OPTIONAL",
        message: "The `optional` modifier must immediately follow the article.",
        suggestion: withoutOptional.join(" "),
        span: optionalToken.span,
      },
    ];
  }
  if (tokens[0]?.text === "a") {
    return [
      {
        code: "SSF_ARTICLE",
        message: "Use `an` before `optional`.",
        suggestion: correctedTokens(tokens, new Map([[0, "an"]])),
        span: tokens[0].span,
      },
    ];
  }
  return [];
}

function referenceKind(
  name: string,
  owned: ReadonlySet<string>,
  external: ReadonlySet<string>,
): SsfReferenceKind {
  const normalized = normalizeTypeName(name);
  if (PRIMITIVE_KEYS.has(normalized)) return "primitive";
  if (external.has(normalized)) return "external";
  if (owned.has(normalized)) return "owned";
  return "unresolved";
}

function typeReference(
  reference: ParsedReference,
  owned: ReadonlySet<string>,
  external: ReadonlySet<string>,
): SsfTypeReference {
  return {
    text: reference.text,
    normalized: normalizeTypeName(reference.text),
    referenceKind: referenceKind(reference.text, owned, external),
    span: reference.span,
  };
}

function fieldType(
  value: ParsedFieldType,
  owned: ReadonlySet<string>,
  external: ReadonlySet<string>,
): SsfFieldType {
  if (value.kind === "named") {
    return { kind: "named", reference: typeReference(value.reference, owned, external) };
  }
  if (value.kind === "enumeration") return value;
  return {
    ...value,
    element:
      value.element.kind === "named"
        ? { kind: "named", reference: typeReference(value.element.reference, owned, external) }
        : value.element,
  };
}

function inventoryEntry(
  normalized: string,
  declarations: readonly ParsedDeclaration[],
): SsfOwnedType {
  const introducedReferences = declarations.flatMap((declaration) => [
    declaration.name,
    ...(declaration.parent === undefined ? [] : [declaration.parent]),
    ...declaration.fields.flatMap(({ value }) =>
      value.kind === "named"
        ? [value.reference]
        : value.kind === "collection" && value.element.kind === "named"
          ? [value.element.reference]
          : [],
    ),
  ]);
  const matching = declarations.filter(({ name }) => normalizeTypeName(name.text) === normalized);
  const references = introducedReferences.filter(
    ({ text }) => normalizeTypeName(text) === normalized,
  );
  return {
    name: normalized,
    declaredNames: [...new Set(references.map(({ text }) => text))],
    roles: [
      ...new Set(
        matching.map(({ declarationKind }) =>
          declarationKind === "subset" ? ("subset" as const) : ("identity" as const),
        ),
      ),
    ],
    declarationSpans: references.map(({ span }) => span),
  };
}

/** Parse the bounded structural SSF grammar while retaining other State lines as opaque text. */
export function parseSimpleStateForm(
  source: string,
  options: SsfParseOptions = {},
): SsfParseResult {
  const tokens = tokenizeSimpleStateForm(source);
  const lines = sourceLines(source, tokens);
  const parsedDeclarations: ParsedDeclaration[] = [];
  const parsedStatements: Array<ParsedDeclaration | SsfOpaqueLine> = [];
  const diagnostics: SsfDiagnostic[] = [];
  let current: ParsedDeclaration | undefined;

  for (const line of lines) {
    if (line.text.trim() === "") continue;
    if (/^[ \t]/.test(line.text)) {
      if (current === undefined) {
        parsedStatements.push(opaqueLine(line));
        continue;
      }
      const field = parseField(line);
      if (field === undefined) current.opaqueBody.push(opaqueLine(line));
      else current.fields.push(field);
      diagnostics.push(...fieldDiagnostics(line));
      current.span = span(current.span.start, lineSpan(line).end);
      continue;
    }
    const declaration = parseDeclaration(line);
    if (declaration === undefined) {
      const opaque = opaqueLine(line);
      parsedStatements.push(opaque);
      current = undefined;
      continue;
    }
    parsedDeclarations.push(declaration);
    parsedStatements.push(declaration);
    current = declaration;
  }

  for (const declaration of parsedDeclarations) {
    const hasFieldLikeBody =
      declaration.fields.length > 0 ||
      declaration.opaqueBody.some(({ text }) => {
        const first = text.trimStart().split(/\s+/, 1)[0];
        return first === "a" || first === "an";
      });
    diagnostics.push(...declarationDiagnostics(declaration, hasFieldLikeBody));
  }
  diagnostics.sort((left, right) => left.span.start.offset - right.span.start.offset);

  const external = new Set((options.externalTypes ?? []).map(normalizeTypeName));
  const ownedNames = new Set<string>();
  const includeOwnedReference = ({ text }: ParsedReference): void => {
    const normalized = normalizeTypeName(text);
    if (!external.has(normalized) && !PRIMITIVE_KEYS.has(normalized)) ownedNames.add(normalized);
  };
  const includeOwnedFieldType = (value: ParsedFieldType): void => {
    if (value.kind === "named") includeOwnedReference(value.reference);
    else if (value.kind === "collection" && value.element.kind === "named") {
      includeOwnedReference(value.element.reference);
    }
  };
  for (const declaration of parsedDeclarations) {
    includeOwnedReference(declaration.name);
    if (declaration.parent !== undefined) includeOwnedReference(declaration.parent);
    for (const field of declaration.fields) includeOwnedFieldType(field.value);
  }
  const declarations: SsfDeclaration[] = parsedDeclarations.map((declaration) => ({
    kind: "declaration",
    name: typeReference(declaration.name, ownedNames, external),
    declarationKind: declaration.declarationKind,
    multiplicity: declaration.multiplicity,
    ...(declaration.parent === undefined
      ? {}
      : { parent: typeReference(declaration.parent, ownedNames, external) }),
    fields: declaration.fields.map((field) => ({
      kind: "field",
      name: field.name,
      inferredName: field.inferredName,
      optional: field.optional,
      value: fieldType(field.value, ownedNames, external),
      span: field.span,
    })),
    opaqueBody: declaration.opaqueBody,
    span: declaration.span,
    signatureSpan: declaration.signatureSpan,
  }));
  const declarationsByStart = new Map(
    declarations.map((declaration) => [declaration.signatureSpan.start.offset, declaration]),
  );
  const statements = parsedStatements.map((statement) =>
    "signature" in statement
      ? (declarationsByStart.get(statement.signatureSpan.start.offset) as SsfDeclaration)
      : statement,
  );
  const opaqueLines = statements.flatMap((statement) =>
    statement.kind === "opaque" ? [statement] : statement.opaqueBody,
  );
  const types = [...ownedNames].sort().map((name) => inventoryEntry(name, parsedDeclarations));
  const identityNames = new Set(
    parsedDeclarations
      .filter(({ declarationKind }) => declarationKind === "collection")
      .map(({ name }) => normalizeTypeName(name.text)),
  );
  return {
    document: {
      statements,
      declarations,
      opaqueLines,
      inventory: {
        identities: types.filter(({ name }) => identityNames.has(name)),
        types,
        external: [...external].sort(),
        primitives: [...PRIMITIVES],
      },
    },
    diagnostics,
  };
}

/** Return only deterministic, mechanically repairable canonical-form diagnostics. */
export function validateSimpleStateForm(source: string): readonly SsfDiagnostic[] {
  return parseSimpleStateForm(source).diagnostics;
}
