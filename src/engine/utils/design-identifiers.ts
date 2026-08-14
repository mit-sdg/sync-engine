/** Shared lexical rules for authored design names and dotted declaration paths. */

export const DESIGN_IDENTIFIER_SOURCE = "[A-Za-z_][A-Za-z0-9_]*";
export const AUTHORED_PATH_SEGMENT_SOURCE = "[A-Za-z_][A-Za-z0-9_-]*";

const DESIGN_IDENTIFIER = new RegExp(`^${DESIGN_IDENTIFIER_SOURCE}$`);
const AUTHORED_PATH_SEGMENT = new RegExp(`^${AUTHORED_PATH_SEGMENT_SOURCE}$`);

export function isDesignIdentifier(value: string): boolean {
  return DESIGN_IDENTIFIER.test(value);
}

export function isAuthoredPathSegment(value: string): boolean {
  return AUTHORED_PATH_SEGMENT.test(value);
}

export function invalidAuthoredPathSegment(path: string): string | undefined {
  return path.split(".").find((segment) => !isAuthoredPathSegment(segment));
}

export function isAuthoredDeclarationPath(path: string): boolean {
  return invalidAuthoredPathSegment(path) === undefined;
}
