export const TYPE_NAME = /^[A-Z][A-Za-z0-9_]*$/;
export const FIELD_NAME = /^[a-z][A-Za-z0-9_]*$/;
export const ENUM_VALUE = /^[A-Z][A-Z0-9_]*$/;
export const PRIMITIVES = ["Date", "DateTime", "Flag", "Number", "String"] as const;
export const PRIMITIVE_NAMES: ReadonlySet<string> = new Set(PRIMITIVES);

/** Words the grammar reads structurally, so no field or set may take them as its name. */
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

/** The name a type implies when none is written: `Author` names `author`, `Users` names `users`. */
export function impliedName(typeName: string): string {
  return `${typeName.slice(0, 1).toLowerCase()}${typeName.slice(1)}`;
}
