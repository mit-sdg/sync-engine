import { dirname, resolve } from "node:path";
import ts from "typescript";

export interface TypeScriptCheckerContext {
  program: ts.Program;
  checker: ts.TypeChecker;
}

export interface TypeScriptSourceContext extends TypeScriptCheckerContext {
  source: ts.SourceFile;
  options: ts.CompilerOptions;
}

/** Load a TypeScript project context for an executable source module. */
export function typeScriptSourceContext(sourcePath: string): TypeScriptSourceContext {
  const absolute = resolve(sourcePath);
  const configPath = ts.findConfigFile(dirname(absolute), ts.sys.fileExists);
  let rootNames = [absolute];
  let options: ts.CompilerOptions = {
    allowArbitraryExtensions: true,
    allowImportingTsExtensions: true,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    noEmit: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ESNext,
  };
  let projectReferences: readonly ts.ProjectReference[] | undefined;
  if (configPath !== undefined) {
    const loaded = ts.readConfigFile(configPath, ts.sys.readFile);
    if (loaded.error !== undefined) {
      throw new Error(
        `TypeScript project configuration failed: ${ts.flattenDiagnosticMessageText(loaded.error.messageText, "\\n")}`,
      );
    }
    const parsed = ts.parseJsonConfigFileContent(loaded.config, ts.sys, dirname(configPath));
    if (parsed.errors.length > 0) {
      throw new Error(
        `TypeScript project configuration failed: ${ts.flattenDiagnosticMessageText(parsed.errors[0].messageText, "\\n")}`,
      );
    }
    rootNames = parsed.fileNames.some((path) => resolve(path) === absolute)
      ? parsed.fileNames
      : [...parsed.fileNames, absolute];
    options = { ...parsed.options, allowArbitraryExtensions: true, noEmit: true };
    projectReferences = parsed.projectReferences;
  }
  const program = ts.createProgram({ rootNames, options, projectReferences });
  const source = program.getSourceFile(absolute);
  if (source === undefined) throw new Error(`TypeScript source cannot be loaded: ${absolute}`);
  return { program, checker: program.getTypeChecker(), source, options };
}

export interface ShapeField {
  name: string;
  optional: boolean;
}

export type ShapeResolution =
  | { ok: true; fields: readonly ShapeField[] }
  | {
      ok: false;
      type: string;
      operation: string;
      detail: string;
      site: ts.Node;
    };

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MAX_TYPE_DEPTH = 32;
const MAX_SHAPE_ALTERNATIVES = 64;

type ShapeAlternatives =
  | { ok: true; alternatives: readonly (readonly ShapeField[])[] }
  | Extract<ShapeResolution, { ok: false }>;

function diagnosticText(diagnostic: ts.Diagnostic): string {
  return ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
}

function declarationOf(type: ts.Type, fallback: ts.Node): ts.Node {
  return type.aliasSymbol?.declarations?.[0] ?? type.getSymbol()?.declarations?.[0] ?? fallback;
}

function displayedType(checker: ts.TypeChecker, type: ts.Type): string {
  return checker.typeToString(
    type,
    undefined,
    ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope,
  );
}

function failure(
  checker: ts.TypeChecker,
  rootType: ts.Type,
  operation: string,
  detail: string,
  site: ts.Node,
): Extract<ShapeResolution, { ok: false }> {
  return { ok: false, type: displayedType(checker, rootType), operation, detail, site };
}

function canonicalShape(fields: readonly ShapeField[]): string {
  return [...fields]
    .map(({ name, optional }) => `${name}${optional ? "?" : ""}`)
    .sort()
    .join("\0");
}

/** Compare field names and optionality without assigning meaning to their types or order. */
export function shapesEqual(left: readonly ShapeField[], right: readonly ShapeField[]): boolean {
  return canonicalShape(left) === canonicalShape(right);
}

function uniqueAlternatives(
  alternatives: readonly (readonly ShapeField[])[],
): readonly (readonly ShapeField[])[] {
  const unique = new Map<string, readonly ShapeField[]>();
  for (const fields of alternatives) {
    const byName = new Map(fields.map((field) => [field.name, field]));
    const shape = [...byName.values()];
    const canonical = canonicalShape(shape);
    if (!unique.has(canonical)) unique.set(canonical, shape);
  }
  return [...unique.values()];
}

function shapeSets(alternatives: readonly (readonly ShapeField[])[]): string {
  return alternatives
    .map((fields) => {
      const names = fields.map(({ name, optional }) => `\`${name}${optional ? "?" : ""}\``);
      return `[${names.length === 0 ? "no fields" : names.join(", ")}]`;
    })
    .join(" and ");
}

function containsUndefined(type: ts.Type): boolean {
  return (
    (type.flags & ts.TypeFlags.Undefined) !== 0 ||
    (type.isUnion() && type.types.some(containsUndefined))
  );
}

function resolveObjectAlternatives(
  type: ts.Type,
  rootType: ts.Type,
  fallback: ts.Node,
  checker: ts.TypeChecker,
  active: Set<ts.Type>,
  depth: number,
): ShapeAlternatives {
  const site = declarationOf(type, fallback);
  if (depth > MAX_TYPE_DEPTH) {
    return failure(
      checker,
      rootType,
      "type expansion",
      `type expansion exceeds ${MAX_TYPE_DEPTH} operations`,
      site,
    );
  }
  if (active.has(type)) {
    return failure(checker, rootType, "cyclic type", "a cyclic alias cannot be resolved", site);
  }
  if ((type.flags & ts.TypeFlags.Any) !== 0) {
    return failure(
      checker,
      rootType,
      "any or unresolved type",
      "the type resolves to `any`, usually because a reference is unresolved",
      site,
    );
  }
  if ((type.flags & ts.TypeFlags.Unknown) !== 0) {
    return failure(checker, rootType, "unknown", "`unknown` has no finite field set", site);
  }
  if ((type.flags & ts.TypeFlags.TypeParameter) !== 0) {
    return failure(
      checker,
      rootType,
      "type parameter",
      "an unresolved type parameter has no finite field set",
      site,
    );
  }
  if ((type.flags & ts.TypeFlags.Never) !== 0) {
    return failure(checker, rootType, "never", "`never` is not an object shape", site);
  }

  active.add(type);
  try {
    if (type.isUnion()) {
      const alternatives: (readonly ShapeField[])[] = [];
      for (const member of type.types) {
        const resolved = resolveObjectAlternatives(
          member,
          rootType,
          fallback,
          checker,
          active,
          depth + 1,
        );
        if (!resolved.ok) return resolved;
        alternatives.push(...resolved.alternatives);
        if (alternatives.length > MAX_SHAPE_ALTERNATIVES) {
          return failure(
            checker,
            rootType,
            "union expansion",
            `the union exceeds ${MAX_SHAPE_ALTERNATIVES} possible shapes`,
            site,
          );
        }
      }
      return { ok: true, alternatives: uniqueAlternatives(alternatives) };
    }

    if (type.isIntersection()) {
      let combined: readonly (readonly ShapeField[])[] = [[]];
      for (const member of type.types) {
        const resolved = resolveObjectAlternatives(
          member,
          rootType,
          fallback,
          checker,
          active,
          depth + 1,
        );
        if (!resolved.ok) return resolved;
        combined = uniqueAlternatives(
          combined.flatMap((left) => resolved.alternatives.map((right) => [...left, ...right])),
        );
        if (combined.length > MAX_SHAPE_ALTERNATIVES) {
          return failure(
            checker,
            rootType,
            "intersection expansion",
            `the intersection exceeds ${MAX_SHAPE_ALTERNATIVES} possible shapes`,
            site,
          );
        }
      }
      return { ok: true, alternatives: combined };
    }

    if ((type.flags & ts.TypeFlags.Object) === 0) {
      return failure(
        checker,
        rootType,
        "non-object type",
        `\`${checker.typeToString(type)}\` is not an object shape`,
        site,
      );
    }
    if (checker.isArrayType(type) || checker.isTupleType(type)) {
      return failure(
        checker,
        rootType,
        "array type",
        "arrays and tuples are not object rows",
        site,
      );
    }
    if (
      checker.getSignaturesOfType(type, ts.SignatureKind.Call).length > 0 ||
      checker.getSignaturesOfType(type, ts.SignatureKind.Construct).length > 0
    ) {
      return failure(
        checker,
        rootType,
        "callable type",
        "callable and constructable values are not object shapes",
        site,
      );
    }

    for (const index of checker.getIndexInfosOfType(type)) {
      if ((index.type.flags & ts.TypeFlags.Never) !== 0) continue;
      return failure(
        checker,
        rootType,
        "index signature",
        "an open index signature does not provide a finite field set",
        index.declaration ?? site,
      );
    }

    const fields: ShapeField[] = [];
    for (const property of checker.getPropertiesOfType(type)) {
      const name = property.getName();
      if (!IDENTIFIER.test(name)) {
        return failure(
          checker,
          rootType,
          "property name",
          `the property ${JSON.stringify(name)} is not a specification field name`,
          property.declarations?.[0] ?? site,
        );
      }
      const propertySite = property.valueDeclaration ?? property.declarations?.[0] ?? site;
      const propertyType = checker.getTypeOfSymbolAtLocation(property, propertySite);
      fields.push({
        name,
        optional:
          (property.flags & ts.SymbolFlags.Optional) !== 0 || containsUndefined(propertyType),
      });
    }
    const object = type as ts.ObjectType;
    if (
      fields.length === 0 &&
      (object.objectFlags & ts.ObjectFlags.Mapped) !== 0 &&
      checker.getIndexInfosOfType(type).length === 0
    ) {
      return failure(
        checker,
        rootType,
        "mapped type",
        "the mapped type does not resolve to finite concrete properties",
        site,
      );
    }
    return { ok: true, alternatives: [fields] };
  } finally {
    active.delete(type);
  }
}

function arrayElement(type: ts.Type, checker: ts.TypeChecker): ts.Type | undefined {
  if (!checker.isArrayType(type) || checker.isTupleType(type)) return undefined;
  return checker.getTypeArguments(type as ts.TypeReference)[0];
}

function resolveQueryAlternatives(
  type: ts.Type,
  rootType: ts.Type,
  fallback: ts.Node,
  checker: ts.TypeChecker,
  depth: number,
): ShapeAlternatives {
  if (depth > MAX_TYPE_DEPTH) {
    return failure(
      checker,
      rootType,
      "type expansion",
      `type expansion exceeds ${MAX_TYPE_DEPTH} operations`,
      declarationOf(type, fallback),
    );
  }
  if (type.isUnion()) {
    const alternatives: (readonly ShapeField[])[] = [];
    for (const member of type.types) {
      const resolved = resolveQueryAlternatives(member, rootType, fallback, checker, depth + 1);
      if (!resolved.ok) return resolved;
      alternatives.push(...resolved.alternatives);
    }
    return { ok: true, alternatives: uniqueAlternatives(alternatives) };
  }
  const element = arrayElement(type, checker);
  return resolveObjectAlternatives(
    element ?? type,
    rootType,
    fallback,
    checker,
    new Set(),
    depth + 1,
  );
}

function compilerDiagnosticFor(program: ts.Program, nodes: readonly ts.Node[]): string | undefined {
  const files = new Set(nodes.map((node) => node.getSourceFile()));
  const diagnostics = [...program.getSyntacticDiagnostics(), ...program.getSemanticDiagnostics()];
  const relevant = diagnostics.find(
    (diagnostic) =>
      diagnostic.category === ts.DiagnosticCategory.Error &&
      diagnostic.file !== undefined &&
      files.has(diagnostic.file),
  );
  return relevant === undefined ? undefined : diagnosticText(relevant);
}

function withCompilerDiagnostic(
  resolution: ShapeResolution,
  context: TypeScriptCheckerContext,
  sourceNode: ts.Node,
): ShapeResolution {
  if (resolution.ok) return resolution;
  const diagnostic = compilerDiagnosticFor(context.program, [sourceNode, resolution.site]);
  return diagnostic === undefined
    ? resolution
    : { ...resolution, detail: `${resolution.detail}; TypeScript reports: ${diagnostic}` };
}

function singleShape(
  alternatives: ShapeAlternatives,
  rootType: ts.Type,
  fallback: ts.Node,
  context: TypeScriptCheckerContext,
): ShapeResolution {
  if (!alternatives.ok) return alternatives;
  const unique = uniqueAlternatives(alternatives.alternatives);
  if (unique.length !== 1) {
    return failure(
      context.checker,
      rootType,
      "ambiguous union or intersection",
      `the alternatives expose differing field shapes ${shapeSets(unique)}`,
      declarationOf(rootType, fallback),
    );
  }
  return { ok: true, fields: unique[0] };
}

/** Resolve one finite object shape from a declared TypeScript type. */
export function shapeOfTypeNode(
  typeNode: ts.TypeNode,
  sourceNode: ts.Node,
  context: TypeScriptCheckerContext,
): ShapeResolution {
  const type = context.checker.getTypeFromTypeNode(typeNode);
  let site: ts.Node = typeNode;
  if (ts.isTypeReferenceNode(typeNode)) {
    const symbol = context.checker.getSymbolAtLocation(typeNode.typeName);
    const target =
      symbol !== undefined && (symbol.flags & ts.SymbolFlags.Alias) !== 0
        ? context.checker.getAliasedSymbol(symbol)
        : symbol;
    site = target?.declarations?.[0] ?? typeNode;
  }
  const alternatives = resolveObjectAlternatives(type, type, site, context.checker, new Set(), 0);
  return withCompilerDiagnostic(
    singleShape(alternatives, type, site, context),
    context,
    sourceNode,
  );
}

/** Resolve an action result object or a query row from a method's return type. */
export function resultShapeOfMethod(
  method: ts.MethodDeclaration,
  kind: "action" | "query",
  context: TypeScriptCheckerContext,
): ShapeResolution {
  const signature = context.checker.getSignatureFromDeclaration(method);
  if (signature === undefined) {
    return {
      ok: false,
      type: method.type?.getText() ?? "unresolved",
      operation: "method signature",
      detail: "the method signature cannot be resolved",
      site: method,
    };
  }
  const declared = context.checker.getReturnTypeOfSignature(signature);
  const awaited = context.checker.getAwaitedType(declared) ?? declared;
  const alternatives =
    kind === "query"
      ? resolveQueryAlternatives(awaited, declared, method, context.checker, 0)
      : resolveObjectAlternatives(awaited, declared, method, context.checker, new Set(), 0);
  return withCompilerDiagnostic(
    singleShape(alternatives, declared, method, context),
    context,
    method,
  );
}
