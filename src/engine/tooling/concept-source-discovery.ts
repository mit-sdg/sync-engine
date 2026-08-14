import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import ts from "typescript";
import { typeScriptSourceContext, type TypeScriptSourceContext } from "./typescript-shapes.ts";

/** Static source provenance for one registration selected by a concept set. */
export interface RegisteredConceptSource {
  /** The application instance name used as the concept-set property. */
  conceptName: string;
  /** The declared name and source of the selected implementation class. */
  className: string;
  classPath: string;
  /** The exact default Markdown import supplying `registerConcept({ spec })`. */
  specPath: string;
  /** The file contents imported by that declaration. */
  specText: string;
}

type DiscoveryContext = TypeScriptSourceContext;

interface RegistrationEntry {
  name: string;
  source: ts.SourceFile;
  value: ts.Expression;
}

interface MarkdownImport {
  declaration: ts.ImportDeclaration;
  specifier: string;
}

function failure(source: ts.SourceFile, detail: string): never {
  throw new Error(`Concept source discovery failed in ${source.fileName}: ${detail}`);
}

function unwrap(expression: ts.Expression): ts.Expression {
  while (
    ts.isParenthesizedExpression(expression) ||
    ts.isSatisfiesExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isNonNullExpression(expression)
  ) {
    expression = expression.expression;
  }
  return expression;
}

function localSymbol(identifier: ts.Identifier, checker: ts.TypeChecker): ts.Symbol | undefined {
  return ts.isShorthandPropertyAssignment(identifier.parent) &&
    identifier.parent.name === identifier
    ? checker.getShorthandAssignmentValueSymbol(identifier.parent)
    : checker.getSymbolAtLocation(identifier);
}

function targetSymbol(identifier: ts.Identifier, checker: ts.TypeChecker): ts.Symbol | undefined {
  const symbol = localSymbol(identifier, checker);
  if (symbol === undefined) return undefined;
  return (symbol.flags & ts.SymbolFlags.Alias) === 0 ? symbol : checker.getAliasedSymbol(symbol);
}

function variableInitializer(
  identifier: ts.Identifier,
  checker: ts.TypeChecker,
): { source: ts.SourceFile; expression: ts.Expression } | undefined {
  const declaration = targetSymbol(identifier, checker)?.declarations?.find(
    ts.isVariableDeclaration,
  );
  return declaration?.initializer === undefined
    ? undefined
    : { source: declaration.getSourceFile(), expression: declaration.initializer };
}

function resolutionKey(source: ts.SourceFile, expression: ts.Expression): string {
  return `${source.fileName}\0${expression.pos}\0${expression.end}`;
}

function objectLiteral(
  source: ts.SourceFile,
  expression: ts.Expression,
  context: DiscoveryContext,
  active = new Set<string>(),
): { source: ts.SourceFile; object: ts.ObjectLiteralExpression } | undefined {
  expression = unwrap(expression);
  if (ts.isObjectLiteralExpression(expression)) return { source, object: expression };
  if (!ts.isIdentifier(expression)) return undefined;
  const key = resolutionKey(source, expression);
  if (active.has(key)) failure(source, `the alias \`${expression.text}\` is cyclic`);
  active.add(key);
  const target = variableInitializer(expression, context.checker);
  const resolved =
    target === undefined
      ? undefined
      : objectLiteral(target.source, target.expression, context, active);
  active.delete(key);
  return resolved;
}

function propertyName(member: ts.ObjectLiteralElementLike): string | undefined {
  if (!ts.isPropertyAssignment(member) && !ts.isShorthandPropertyAssignment(member)) {
    return undefined;
  }
  return ts.isIdentifier(member.name) || ts.isStringLiteral(member.name)
    ? member.name.text
    : undefined;
}

function propertyValue(
  source: ts.SourceFile,
  object: ts.ObjectLiteralExpression,
  name: string,
  context: DiscoveryContext,
): { source: ts.SourceFile; expression: ts.Expression } | undefined {
  for (let index = object.properties.length - 1; index >= 0; index -= 1) {
    const member = object.properties[index];
    if (ts.isSpreadAssignment(member)) {
      const spread = objectLiteral(source, member.expression, context);
      if (spread === undefined) {
        failure(
          source,
          `the spread used to determine registration property \`${name}\` is dynamic`,
        );
      }
      const found = propertyValue(spread.source, spread.object, name, context);
      if (found !== undefined) return found;
      continue;
    }
    if (propertyName(member) !== name) continue;
    if (ts.isPropertyAssignment(member)) return { source, expression: member.initializer };
    if (ts.isShorthandPropertyAssignment(member)) return { source, expression: member.name };
  }
  return undefined;
}

function registrationEntries(
  source: ts.SourceFile,
  object: ts.ObjectLiteralExpression,
  context: DiscoveryContext,
  active = new Set<string>(),
): RegistrationEntry[] {
  const entries: RegistrationEntry[] = [];
  for (const member of object.properties) {
    if (ts.isSpreadAssignment(member)) {
      const key = resolutionKey(source, member.expression);
      if (active.has(key)) failure(source, "a selected registration-map spread is cyclic");
      active.add(key);
      const spread = objectLiteral(source, member.expression, context);
      if (spread === undefined) failure(source, "a selected registration-map spread is dynamic");
      entries.push(...registrationEntries(spread.source, spread.object, context, active));
      active.delete(key);
      continue;
    }
    const name = propertyName(member);
    const value = ts.isPropertyAssignment(member)
      ? member.initializer
      : ts.isShorthandPropertyAssignment(member)
        ? member.name
        : undefined;
    if (name === undefined || value === undefined) {
      failure(source, "a selected registration-map entry does not have a static property name");
    }
    entries.push({ name, source, value });
  }
  return entries;
}

function registrationCall(
  source: ts.SourceFile,
  expression: ts.Expression,
  context: DiscoveryContext,
  active = new Set<string>(),
): { source: ts.SourceFile; call: ts.CallExpression } | undefined {
  expression = unwrap(expression);
  if (
    ts.isCallExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    expression.expression.text === "registerConcept"
  ) {
    return { source, call: expression };
  }
  if (!ts.isIdentifier(expression)) return undefined;
  const key = resolutionKey(source, expression);
  if (active.has(key)) failure(source, `the registration alias \`${expression.text}\` is cyclic`);
  active.add(key);
  const target = variableInitializer(expression, context.checker);
  const resolved =
    target === undefined
      ? undefined
      : registrationCall(target.source, target.expression, context, active);
  active.delete(key);
  return resolved;
}

function classDeclaration(
  source: ts.SourceFile,
  expression: ts.Expression,
  context: DiscoveryContext,
  active = new Set<string>(),
): ts.ClassDeclaration | undefined {
  expression = unwrap(expression);
  if (!ts.isIdentifier(expression)) return undefined;
  const key = resolutionKey(source, expression);
  if (active.has(key)) failure(source, `the class alias \`${expression.text}\` is cyclic`);
  active.add(key);
  const declaration = targetSymbol(expression, context.checker)?.declarations?.find(
    ts.isClassDeclaration,
  );
  if (declaration !== undefined) return declaration;
  const target = variableInitializer(expression, context.checker);
  const resolved =
    target === undefined
      ? undefined
      : classDeclaration(target.source, target.expression, context, active);
  active.delete(key);
  return resolved;
}

function markdownImport(
  source: ts.SourceFile,
  expression: ts.Expression,
  context: DiscoveryContext,
  active = new Set<string>(),
): MarkdownImport | undefined {
  expression = unwrap(expression);
  if (!ts.isIdentifier(expression)) return undefined;
  const key = resolutionKey(source, expression);
  if (active.has(key)) failure(source, `the specification alias \`${expression.text}\` is cyclic`);
  active.add(key);

  const local = localSymbol(expression, context.checker);
  for (const declaration of local?.declarations ?? []) {
    if (ts.isImportClause(declaration) && declaration.name?.text === expression.text) {
      const imported = declaration.parent;
      if (ts.isImportDeclaration(imported) && ts.isStringLiteral(imported.moduleSpecifier)) {
        return { declaration: imported, specifier: imported.moduleSpecifier.text };
      }
    }
    if (
      ts.isImportSpecifier(declaration) &&
      (declaration.propertyName?.text ?? declaration.name.text) === "default"
    ) {
      const imported = declaration.parent.parent.parent;
      if (ts.isImportDeclaration(imported) && ts.isStringLiteral(imported.moduleSpecifier)) {
        return { declaration: imported, specifier: imported.moduleSpecifier.text };
      }
    }
  }

  const target = variableInitializer(expression, context.checker);
  const resolved =
    target === undefined
      ? undefined
      : markdownImport(target.source, target.expression, context, active);
  active.delete(key);
  return resolved;
}

function wildcardMatch(pattern: string, value: string): string | undefined {
  const star = pattern.indexOf("*");
  if (star < 0) return pattern === value ? "" : undefined;
  const prefix = pattern.slice(0, star);
  const suffix = pattern.slice(star + 1);
  return value.startsWith(prefix) && value.endsWith(suffix)
    ? value.slice(prefix.length, value.length - suffix.length)
    : undefined;
}

function hasTextImportAttribute(imported: MarkdownImport): boolean {
  const attributes = imported.declaration.attributes;
  if (attributes?.token !== ts.SyntaxKind.WithKeyword || attributes.elements.length !== 1) {
    return false;
  }
  const [attribute] = attributes.elements;
  const name =
    ts.isIdentifier(attribute.name) || ts.isStringLiteral(attribute.name)
      ? attribute.name.text
      : undefined;
  return name === "type" && ts.isStringLiteral(attribute.value) && attribute.value.text === "text";
}

function textImportPath(imported: MarkdownImport, context: DiscoveryContext): string {
  const importer = imported.declaration.getSourceFile();
  const specifier = imported.specifier;
  const direct = isAbsolute(specifier)
    ? specifier
    : specifier.startsWith(".")
      ? resolve(dirname(importer.fileName), specifier)
      : undefined;
  if (direct !== undefined) {
    if (!existsSync(direct))
      failure(importer, `default specification import \`${specifier}\` cannot be resolved`);
    return direct;
  }

  const baseUrl =
    context.options.baseUrl ??
    (context.options as ts.CompilerOptions & { pathsBasePath?: string }).pathsBasePath;
  const candidates: string[] = [];
  if (baseUrl !== undefined) {
    for (const [pattern, substitutions] of Object.entries(context.options.paths ?? {})) {
      const wildcard = wildcardMatch(pattern, specifier);
      if (wildcard === undefined) continue;
      for (const substitution of substitutions) {
        candidates.push(resolve(baseUrl, substitution.replace("*", wildcard)));
      }
    }
    candidates.push(resolve(baseUrl, specifier));
  }
  const resolved = candidates.find(existsSync);
  if (resolved !== undefined) return resolved;

  const module = ts.resolveModuleName(
    specifier,
    importer.fileName,
    context.options,
    ts.sys,
  ).resolvedModule;
  if (module !== undefined && existsSync(module.resolvedFileName)) return module.resolvedFileName;
  failure(importer, `default specification import \`${specifier}\` cannot be resolved`);
}

function registrationFactory(
  expression: ts.Expression,
  context: DiscoveryContext,
): "conceptSet" | "vocabulary" | undefined {
  expression = unwrap(expression);
  if (!ts.isIdentifier(expression)) return undefined;
  if (expression.text === "conceptSet" || expression.text === "vocabulary") {
    return expression.text;
  }
  for (const declaration of localSymbol(expression, context.checker)?.declarations ?? []) {
    if (ts.isImportSpecifier(declaration)) {
      const imported = declaration.propertyName?.text ?? declaration.name.text;
      if (imported === "conceptSet" || imported === "vocabulary") return imported;
    }
  }
  return undefined;
}

/**
 * Locate the implementation and exact Markdown source for every registration selected by a
 * `conceptSet(...)` or `vocabulary(...)` in the supplied module. Static discovery fails closed
 * rather than guessing through computed registrations or specification construction.
 */
export function registeredConceptSources(
  conceptSetPath: string,
  suppliedContext?: TypeScriptSourceContext,
): RegisteredConceptSource[] {
  const absolute = resolve(conceptSetPath);
  const context = suppliedContext ?? typeScriptSourceContext(absolute);
  const source = context.source;

  const calls: { call: ts.CallExpression; kind: "conceptSet" | "vocabulary" }[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const kind = registrationFactory(node.expression, context);
      if (kind !== undefined) calls.push({ call: node, kind });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  const entries: RegistrationEntry[] = [];
  for (const { call, kind } of calls) {
    const argument = call.arguments[0];
    if (argument === undefined) failure(source, `${kind} has no declaration object`);
    const declaration = objectLiteral(source, argument, context);
    if (declaration === undefined) failure(source, `the selected ${kind} declaration is dynamic`);
    const registrationValue =
      kind === "conceptSet"
        ? { source: declaration.source, expression: declaration.object as ts.Expression }
        : propertyValue(declaration.source, declaration.object, "concepts", context);
    if (registrationValue === undefined) continue;
    const registrations = objectLiteral(
      registrationValue.source,
      registrationValue.expression,
      context,
    );
    if (registrations === undefined) failure(source, `the selected ${kind} concept map is dynamic`);
    const selected = new Map<string, RegistrationEntry>();
    for (const entry of registrationEntries(registrations.source, registrations.object, context)) {
      // Object assignment and spread use ordinary JavaScript last-write-wins semantics.
      selected.set(entry.name, entry);
    }
    entries.push(...selected.values());
  }

  const duplicate = entries.find(
    (entry, index) => entries.findIndex(({ name }) => name === entry.name) !== index,
  );
  if (duplicate !== undefined) {
    failure(duplicate.source, `the selected concept instance \`${duplicate.name}\` is ambiguous`);
  }

  return entries.map((entry) => {
    const registration = registrationCall(entry.source, entry.value, context);
    const directOptions = objectLiteral(entry.source, entry.value, context);
    const argument = registration?.call.arguments[0];
    if (registration !== undefined && argument === undefined) {
      failure(registration.source, `registration \`${entry.name}\` has no options`);
    }
    const options =
      registration === undefined
        ? directOptions
        : objectLiteral(registration.source, argument!, context);
    if (options === undefined) {
      failure(
        registration?.source ?? entry.source,
        `registration \`${entry.name}\` is dynamic or not a static registration object`,
      );
    }

    const classValue = propertyValue(options.source, options.object, "class", context);
    if (classValue === undefined)
      failure(options.source, `registration \`${entry.name}\` has no class`);
    const implementation = classDeclaration(classValue.source, classValue.expression, context);
    if (implementation?.name === undefined) {
      return failure(
        classValue.source,
        `registration \`${entry.name}\` class source cannot be resolved`,
      );
    }

    const specValue = propertyValue(options.source, options.object, "spec", context);
    if (specValue === undefined)
      failure(options.source, `registration \`${entry.name}\` has no spec`);
    const imported = markdownImport(specValue.source, specValue.expression, context);
    if (imported === undefined) {
      return failure(
        specValue.source,
        `registration \`${entry.name}\` spec is constructed, dynamic, or not a default import`,
      );
    }
    const specPath = textImportPath(imported, context);
    if (!specPath.toLowerCase().endsWith(".md")) {
      return failure(
        imported.declaration.getSourceFile(),
        `registration \`${entry.name}\` specification import does not resolve to Markdown`,
      );
    }
    if (!hasTextImportAttribute(imported)) {
      return failure(
        imported.declaration.getSourceFile(),
        `registration \`${entry.name}\` default Markdown import must use with { type: "text" }`,
      );
    }

    return {
      conceptName: entry.name,
      className: implementation.name.text,
      classPath: implementation.getSourceFile().fileName,
      specPath,
      specText: readFileSync(specPath, "utf8"),
    };
  });
}
