export const TYPE_NAME = /^[A-Z][A-Za-z0-9_]*$/;
export const FIELD_NAME = /^[a-z][A-Za-z0-9_]*$/;
export const ENUM_VALUE = /^[A-Z][A-Z0-9_]*$/;
export const PRIMITIVES = ["Date", "DateTime", "Flag", "Number", "String"] as const;
export const PRIMITIVE_NAMES: ReadonlySet<string> = new Set(PRIMITIVES);
