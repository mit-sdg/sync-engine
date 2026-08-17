import { PRIMITIVES, PRIMITIVE_NAMES } from "./names.ts";
import type { ParsedAlias, ParsedDeclaration, ParsedEnumeration, SsfDiagnostic } from "./model.ts";

function duplicateEnumerationDiagnostics(enumeration: ParsedEnumeration): SsfDiagnostic[] {
  const seen = new Set<string>();
  const diagnostics: SsfDiagnostic[] = [];
  for (const value of enumeration.valueReferences) {
    if (seen.has(value.text))
      diagnostics.push({
        code: "SSF_DUPLICATE_ENUM_VALUE",
        message: `Enumeration value ${JSON.stringify(value.text)} occurs more than once in this field.`,
        suggestion: "List each enumeration value exactly once in this field.",
        span: value.span,
      });
    seen.add(value.text);
  }
  return diagnostics;
}

/** Validate exact type namespaces and declaration-local field/enum scopes. */
export function localIntegrityDiagnostics(
  declarations: readonly ParsedDeclaration[],
  aliases: readonly ParsedAlias[],
  external: ReadonlySet<string>,
): readonly SsfDiagnostic[] {
  const diagnostics: SsfDiagnostic[] = [];
  const seenDeclarations = new Set<string>();
  for (const declaration of declarations) {
    const name = declaration.name.text;
    if (seenDeclarations.has(name))
      diagnostics.push({
        code: "SSF_DUPLICATE_DECLARATION",
        message: `Structural declaration ${JSON.stringify(name)} is declared more than once.`,
        suggestion: "Give every structural declaration a unique exact type name.",
        span: declaration.name.span,
      });
    seenDeclarations.add(name);
    if (external.has(name) || PRIMITIVE_NAMES.has(name))
      diagnostics.push({
        code: "SSF_NAME_COLLISION",
        message: `Structural declaration ${JSON.stringify(name)} collides with ${external.has(name) ? "an external type" : "an SSF primitive"}.`,
        suggestion:
          "Rename the structural declaration; owned, external, and primitive names are one exact namespace.",
        span: declaration.name.span,
      });

    const seenFields = new Set<string>();
    for (const field of declaration.fields) {
      if (seenFields.has(field.name))
        diagnostics.push({
          code: "SSF_DUPLICATE_FIELD",
          message: `Field ${JSON.stringify(field.name)} occurs more than once in declaration ${JSON.stringify(name)}.`,
          suggestion:
            "Use a unique effective field name within this declaration, including inferred names.",
          span: field.nameSpan,
        });
      seenFields.add(field.name);
      const enumeration =
        field.value.kind === "enumeration"
          ? field.value
          : field.value.kind === "collection" && field.value.element.kind === "enumeration"
            ? field.value.element
            : undefined;
      if (enumeration !== undefined)
        diagnostics.push(...duplicateEnumerationDiagnostics(enumeration));
    }
  }

  const occupied = new Set([...seenDeclarations, ...external, ...PRIMITIVES]);
  const seenAliases = new Set<string>();
  for (const alias of aliases) {
    if (occupied.has(alias.name.text) || seenAliases.has(alias.name.text))
      diagnostics.push({
        code: "SSF_ALIAS_NAME_COLLISION",
        message: `Alias name ${JSON.stringify(alias.name.text)} is already used in the SSF type namespace.`,
        suggestion:
          "Give the alias a unique exact name that is not structural, external, primitive, or another alias.",
        span: alias.name.span,
      });
    seenAliases.add(alias.name.text);
  }
  return diagnostics;
}
