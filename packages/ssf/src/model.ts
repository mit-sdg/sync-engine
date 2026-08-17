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
  | "SSF_ARTICLE"
  | "SSF_DUPLICATE_DECLARATION"
  | "SSF_DUPLICATE_ENUM_VALUE"
  | "SSF_DUPLICATE_FIELD"
  | "SSF_INVALID_ALIAS_TARGET"
  | "SSF_INVALID_SUBSET_PARENT"
  | "SSF_MALFORMED_ALIAS"
  | "SSF_MALFORMED_DECLARATION"
  | "SSF_MALFORMED_FIELD"
  | "SSF_MISSING_WITH"
  | "SSF_MISPLACED_OPTIONAL"
  | "SSF_NAME_COLLISION"
  | "SSF_NEAR_MISS_KEYWORD"
  | "SSF_OPTIONAL_COLLECTION"
  | "SSF_SUBSET_CYCLE"
  | "SSF_SUBSET_SELF_PARENT";

export interface SsfDiagnostic {
  readonly code: SsfDiagnosticCode;
  readonly message: string;
  readonly suggestion: string;
  readonly span: SsfSpan;
}

export interface SsfTypeName {
  /** Spelling retained from the State text. */
  readonly text: string;
  /** Exact owned structural name used for declaration and reference joins. */
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
  readonly name: SsfTypeReference;
  readonly declarationKind: "collection" | "subset";
  readonly multiplicity: SsfMultiplicity;
  readonly parent?: SsfTypeReference;
  readonly fields: readonly SsfField[];
  readonly opaqueBody: readonly SsfOpaqueLine[];
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

export type SsfStatement = SsfDeclaration | SsfAlias | SsfOpaqueLine;

export interface SsfOwnedType {
  /** Exact spelling of the structural State declaration. */
  readonly name: string;
  /** The declaration spelling and its exact explicit aliases. */
  readonly declaredNames: readonly string[];
  readonly roles: readonly ("identity" | "subset")[];
  readonly declarationSpans: readonly SsfSpan[];
}

export interface SsfTypeInventory {
  readonly identities: readonly SsfOwnedType[];
  readonly types: readonly SsfOwnedType[];
  readonly external: readonly string[];
  readonly primitives: readonly string[];
}

export interface SsfDocument {
  readonly statements: readonly SsfStatement[];
  readonly declarations: readonly SsfDeclaration[];
  readonly aliases: readonly SsfAlias[];
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

export interface ParsedEnumeration {
  readonly kind: "enumeration";
  readonly values: readonly string[];
  readonly valueReferences: readonly ParsedReference[];
  readonly span: SsfSpan;
}

export interface ParsedNamed {
  readonly kind: "named";
  readonly reference: ParsedReference;
}

export interface ParsedCollection {
  readonly kind: "collection";
  readonly multiplicity: "set" | "sequence";
  readonly element: ParsedNamed | ParsedEnumeration;
  readonly span: SsfSpan;
}

export type ParsedFieldType = ParsedNamed | ParsedEnumeration | ParsedCollection;

export interface ParsedField {
  readonly name: string;
  readonly nameSpan: SsfSpan;
  readonly inferredName: boolean;
  readonly optional: boolean;
  readonly value: ParsedFieldType;
  readonly span: SsfSpan;
}

export interface ParsedDeclaration {
  readonly kind: "declaration";
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

export interface ParsedAlias {
  readonly kind: "alias";
  readonly name: ParsedReference;
  readonly target: ParsedReference;
  readonly span: SsfSpan;
}

export type ParsedStatement = ParsedDeclaration | ParsedAlias | SsfOpaqueLine;
