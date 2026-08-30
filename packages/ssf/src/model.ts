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
  | "SSF_ALIAS_NAME_COLLISION"
  | "SSF_AMBIGUOUS_AUTOMATIC_ALIAS"
  | "SSF_ARTICLE"
  | "SSF_DUPLICATE_DECLARATION"
  | "SSF_DUPLICATE_FIELD"
  | "SSF_DUPLICATE_UNIQUE"
  | "SSF_INVALID_ALIAS_TARGET"
  | "SSF_INVALID_EXTERNAL_NAME"
  | "SSF_INVALID_SUBSET_PARENT"
  | "SSF_MALFORMED_ALIAS"
  | "SSF_MALFORMED_DECLARATION"
  | "SSF_MALFORMED_FIELD"
  | "SSF_MISSING_WITH"
  | "SSF_MISPLACED_MODIFIER"
  | "SSF_NAME_COLLISION"
  | "SSF_NEAR_MISS_KEYWORD"
  | "SSF_OPTIONAL_COLLECTION"
  | "SSF_ORPHANED_LINE"
  | "SSF_SUBSET_CYCLE"
  | "SSF_INVALID_SUBSET_CONDITION"
  | "SSF_SUBSET_SELF_PARENT"
  | "SSF_UNDECLARED_TYPE"
  | "SSF_UNKNOWN_UNIQUE_FIELD";

interface SsfDiagnosticDetail {
  readonly severity: "error" | "advice";
  readonly code: SsfDiagnosticCode;
  readonly message: string;
  readonly suggestion: string;
}

/** State diagnostics have a span; option diagnostics name their external type instead. */
export type SsfDiagnostic = SsfDiagnosticDetail &
  (
    | { readonly span: SsfSpan; readonly externalType?: never }
    | { readonly externalType: string; readonly span?: never }
  );

type DiagnosticDetail<T> = T extends unknown ? Omit<T, "severity"> : never;

export function error(detail: DiagnosticDetail<SsfDiagnostic>): SsfDiagnostic {
  return { severity: "error", ...detail };
}

export interface SsfTypeName {
  /** Spelling retained from the State text. */
  readonly text: string;
  /** Exact owned structural name used for declaration and reference joins. */
  readonly normalized: string;
}

/**
 * `unresolved` is no longer a silent category: a field value that lands there always
 * carries `SSF_UNDECLARED_TYPE`, and every other case already has its own diagnostic.
 */
export type SsfReferenceKind = "external" | "local" | "owned" | "primitive" | "unresolved";

export interface SsfTypeReference extends SsfTypeName {
  readonly referenceKind: SsfReferenceKind;
  readonly span: SsfSpan;
}

export interface SsfNamedFieldType {
  readonly kind: "named";
  readonly reference: SsfTypeReference;
}

export interface SsfCollectionFieldType {
  readonly kind: "collection";
  readonly multiplicity: "set" | "sequence";
  readonly element: SsfNamedFieldType;
  readonly span: SsfSpan;
}

export type SsfFieldType = SsfNamedFieldType | SsfCollectionFieldType;

export interface SsfField {
  readonly kind: "field";
  readonly name: string;
  readonly optional: boolean;
  readonly unique: boolean;
  readonly value: SsfFieldType;
  readonly span: SsfSpan;
}

/** A uniqueness constraint over a combination of two or more of a declaration's fields. */
export interface SsfUniqueConstraint {
  readonly kind: "unique";
  readonly fields: readonly string[];
  readonly span: SsfSpan;
}

export type SsfMultiplicity = "element" | "sequence" | "set";

export interface SsfRuleLine {
  readonly kind: "rule";
  readonly text: string;
  readonly span: SsfSpan;
}

/** A subset's membership test: the field and the declared value its members carry. */
export interface SsfSubsetCondition {
  readonly field: string;
  readonly values: readonly string[];
  readonly span: SsfSpan;
}

export interface SsfDeclaration {
  readonly kind: "declaration";
  readonly name: SsfTypeReference;
  readonly declarationKind: "collection" | "subset";
  readonly multiplicity: SsfMultiplicity;
  readonly parent?: SsfTypeReference;
  readonly condition?: SsfSubsetCondition;
  readonly fields: readonly SsfField[];
  readonly constraints: readonly SsfUniqueConstraint[];
  readonly rules: readonly SsfRuleLine[];
  readonly span: SsfSpan;
  readonly signatureSpan: SsfSpan;
}

/** An exact additional owned spelling for one structural declaration. */
export interface SsfAlias {
  readonly kind: "alias";
  readonly name: SsfTypeReference;
  readonly target: SsfTypeReference;
  readonly span: SsfSpan;
}

export type SsfStatement = SsfDeclaration | SsfAlias | SsfRuleLine;

export interface SsfTypeInventory {
  readonly ownedTypeNames: readonly string[];
  readonly external: readonly string[];
  readonly primitives: readonly string[];
}

export interface SsfDocument {
  readonly statements: readonly SsfStatement[];
  readonly declarations: readonly SsfDeclaration[];
  readonly aliases: readonly SsfAlias[];
  /** Top-level rules; declaration-attached rules remain on their declaration. */
  readonly rules: readonly SsfRuleLine[];
  readonly inventory: SsfTypeInventory;
}

/** One concept-local type declared in the Types fence: a refinement, enumeration, or opaque. */
export interface SsfLocalType {
  readonly name: string;
  /** Declared values, for an enumeration; absent for a refinement or an opaque type. */
  readonly values?: readonly string[];
}

export interface SsfParseOptions {
  /** External parameter names in SSF `TYPE_NAME` form. */
  readonly externalTypes?: readonly string[];
  /** Concept-local types declared in the Types fence. */
  readonly localTypes?: readonly SsfLocalType[];
  /** Exact type spellings authored in action/query parameter and result expressions. */
  readonly evidenceTypeNames?: readonly string[];
}

export interface SsfParseResult {
  readonly document: SsfDocument;
  readonly diagnostics: readonly SsfDiagnostic[];
}

export interface SourceLine {
  readonly text: string;
  readonly line: number;
  readonly start: number;
  readonly end: number;
  readonly tokens: readonly SsfToken[];
}

export interface ParsedReference {
  readonly text: string;
  readonly span: SsfSpan;
}

export interface ParsedNamed {
  readonly kind: "named";
  readonly reference: ParsedReference;
}

export type ParsedFieldType =
  | ParsedNamed
  | {
      readonly kind: "collection";
      readonly multiplicity: "set" | "sequence";
      readonly element: ParsedNamed;
      readonly span: SsfSpan;
    };

export interface ParsedField {
  readonly name: string;
  readonly nameSpan: SsfSpan;
  readonly optional: boolean;
  readonly unique: boolean;
  readonly value: ParsedFieldType;
  readonly span: SsfSpan;
}

export interface ParsedUniqueConstraint {
  readonly fields: readonly ParsedReference[];
  readonly span: SsfSpan;
}

export interface ParsedSubsetCondition {
  readonly field: ParsedReference;
  readonly values: readonly ParsedReference[];
  readonly span: SsfSpan;
}

export interface ParsedDeclaration {
  readonly name: ParsedReference;
  readonly declarationKind: "collection" | "subset";
  readonly multiplicity: SsfMultiplicity;
  readonly parent?: ParsedReference;
  readonly condition?: ParsedSubsetCondition;
  readonly fields: ParsedField[];
  readonly constraints: ParsedUniqueConstraint[];
  readonly rules: SsfRuleLine[];
  span: SsfSpan;
  readonly signatureSpan: SsfSpan;
  readonly signature: SourceLine;
  readonly structuralIndex: number;
  readonly authoredStructural: string;
  readonly hasWith: boolean;
}

export interface ParsedAlias {
  readonly name: ParsedReference;
  readonly target: ParsedReference;
  readonly span: SsfSpan;
}
