export const TYPE_NAME = /^[A-Z][A-Za-z0-9_]*$/;
export const FIELD_NAME = /^[a-z][A-Za-z0-9_]*$/;
export const ENUM_VALUE = /^[A-Z][A-Z0-9_]*$/;
export const PRIMITIVES = ["Date", "DateTime", "Flag", "Number", "String"] as const;
export const PRIMITIVE_NAMES: ReadonlySet<string> = new Set(PRIMITIVES);

/** Structural words, which the grammar never reads as a separately written subset name. */
export const RESERVED_NAMES: ReadonlySet<string> = new Set([
  "element",
  "of",
  "optional",
  "seq",
  "set",
  "unique",
  "where",
  "with",
]);

/**
 * The name a type implies when none is written: its words joined, with a lowercase first
 * letter. `Author` names `author`, and `Verified User` names `verifiedUser`.
 */
export function impliedName(typeName: string): string {
  const joined = typeName.split(" ").join("");
  return `${joined.slice(0, 1).toLowerCase()}${joined.slice(1)}`;
}

/** A name's identifier in code: its words joined in PascalCase, as `VerifiedUsers`. */
export function identifierOf(typeName: string): string {
  return typeName.split(" ").join("");
}
