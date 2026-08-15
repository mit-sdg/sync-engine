/** Stable identities assigned to authored declarations by the selected composition. */

import { invalidAuthoredPathSegment } from "@engine/utils/design-identifiers";

export type AuthoredDeclarationKind = "reaction" | "view" | "former";
export type AuthoredDeclarationSource = AuthoredDeclarationKind | "endpoint";

/** Provenance shared by an authored declaration and every runtime entry lowered from it. */
export interface AuthoredDeclarationIdentity {
  /** The typed design-link kind. Endpoint trees are reactions at the design boundary. */
  readonly kind: AuthoredDeclarationKind;
  readonly identity: string;
  /** Present when the authoring construction differs from the design-link kind. */
  readonly source?: "endpoint";
}

/** Validate and construct one selected composition identity. */
export function authoredDeclarationIdentity(
  source: AuthoredDeclarationSource,
  identity: string,
): AuthoredDeclarationIdentity {
  const invalid = invalidAuthoredPathSegment(identity);
  if (invalid !== undefined) {
    throw new Error(
      `assemble: ${source} declaration path ${JSON.stringify(identity)} has invalid segment ` +
        `${JSON.stringify(invalid)}; each segment must start with a letter or "_" and contain only letters, digits, "_", or "-".`,
    );
  }
  return source === "endpoint"
    ? { kind: "reaction", identity, source: "endpoint" }
    : { kind: source, identity };
}

/** Enforce one selected path per declaration object while retaining its inventory. */
export class AuthoredDeclarationIdentities {
  private readonly byObject = new WeakMap<object, AuthoredDeclarationIdentity>();
  private readonly selected: AuthoredDeclarationIdentity[] = [];

  install(
    declaration: object,
    source: AuthoredDeclarationSource,
    identity: string,
  ): AuthoredDeclarationIdentity {
    const authored = authoredDeclarationIdentity(source, identity);
    const previous = this.byObject.get(declaration);
    if (previous !== undefined) {
      throw new Error(
        `assemble: the same ${source} declaration object is installed at both ` +
          `${JSON.stringify(previous.identity)} and ${JSON.stringify(identity)}; ` +
          "a declaration object has one authored identity.",
      );
    }
    this.byObject.set(declaration, authored);
    this.selected.push(authored);
    return authored;
  }

  inventory(): readonly AuthoredDeclarationIdentity[] {
    return this.selected;
  }
}
