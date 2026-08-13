import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import ts from "typescript";

export interface RegisteredClassSource {
  conceptName: string;
  className: string;
  classPath: string;
}

interface ImportBinding {
  from: string;
  imported: string;
}

function parse(path: string): ts.SourceFile {
  return ts.createSourceFile(
    path,
    readFileSync(path, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
}

function importsOf(source: ts.SourceFile): Map<string, ImportBinding> {
  const imports = new Map<string, ImportBinding>();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }
    const clause = statement.importClause;
    if (clause?.name !== undefined) {
      imports.set(clause.name.text, { from: statement.moduleSpecifier.text, imported: "default" });
    }
    const bindings = clause?.namedBindings;
    if (bindings !== undefined && ts.isNamedImports(bindings)) {
      for (const binding of bindings.elements) {
        imports.set(binding.name.text, {
          from: statement.moduleSpecifier.text,
          imported: binding.propertyName?.text ?? binding.name.text,
        });
      }
    }
  }
  return imports;
}

function variable(source: ts.SourceFile, name: string): ts.VariableDeclaration | undefined {
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === name) return declaration;
    }
  }
  return undefined;
}

function unwrap(expression: ts.Expression): ts.Expression {
  while (
    ts.isParenthesizedExpression(expression) ||
    ts.isSatisfiesExpression(expression) ||
    ts.isAsExpression(expression)
  ) {
    expression = expression.expression;
  }
  return expression;
}

function objectLiteral(
  source: ts.SourceFile,
  expression: ts.Expression,
  visited = new Set<string>(),
): ts.ObjectLiteralExpression | undefined {
  expression = unwrap(expression);
  if (ts.isObjectLiteralExpression(expression)) return expression;
  if (!ts.isIdentifier(expression)) return undefined;
  const key = `${source.fileName}\0${expression.text}`;
  if (visited.has(key)) return undefined;
  visited.add(key);
  const initializer = variable(source, expression.text)?.initializer;
  return initializer === undefined ? undefined : objectLiteral(source, initializer, visited);
}

function registrationCall(
  source: ts.SourceFile,
  expression: ts.Expression,
  visited: Set<string>,
): { call: ts.CallExpression; source: ts.SourceFile } | undefined {
  expression = unwrap(expression);
  if (
    ts.isCallExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    expression.expression.text === "registerConcept"
  ) {
    return { call: expression, source };
  }
  if (!ts.isIdentifier(expression)) return undefined;

  const key = `${source.fileName}\0${expression.text}`;
  if (visited.has(key)) return undefined;
  visited.add(key);
  const local = variable(source, expression.text)?.initializer;
  if (local !== undefined) return registrationCall(source, local, visited);

  const imported = importsOf(source).get(expression.text);
  if (imported === undefined || imported.imported === "default") return undefined;
  const targetPath = resolve(dirname(source.fileName), imported.from);
  const target = parse(targetPath);
  const initializer = variable(target, imported.imported)?.initializer;
  return initializer === undefined ? undefined : registrationCall(target, initializer, visited);
}

function property(object: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined {
  for (const member of object.properties) {
    if (
      ts.isPropertyAssignment(member) &&
      ((ts.isIdentifier(member.name) && member.name.text === name) ||
        (ts.isStringLiteral(member.name) && member.name.text === name))
    ) {
      return member.initializer;
    }
    if (ts.isShorthandPropertyAssignment(member) && member.name.text === name) return member.name;
  }
  return undefined;
}

function conceptName(property: ts.ObjectLiteralElementLike): string | undefined {
  if (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) {
    return ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)
      ? property.name.text
      : undefined;
  }
  return undefined;
}

interface RegistrationEntry {
  name: string;
  source: ts.SourceFile;
  value: ts.Expression;
}

function registrationEntries(
  source: ts.SourceFile,
  object: ts.ObjectLiteralExpression,
  visited = new Set<string>(),
): RegistrationEntry[] {
  const entries: RegistrationEntry[] = [];
  for (const entry of object.properties) {
    if (ts.isSpreadAssignment(entry) && ts.isIdentifier(entry.expression)) {
      const local = variable(source, entry.expression.text)?.initializer;
      if (local !== undefined) {
        const spread = objectLiteral(source, local);
        if (spread !== undefined) entries.push(...registrationEntries(source, spread, visited));
        continue;
      }
      const imported = importsOf(source).get(entry.expression.text);
      if (imported === undefined || imported.imported === "default") continue;
      const targetPath = resolve(dirname(source.fileName), imported.from);
      const key = `${targetPath}\0${imported.imported}`;
      if (visited.has(key)) continue;
      visited.add(key);
      const target = parse(targetPath);
      const spread = variable(target, imported.imported)?.initializer;
      const spreadObject = spread === undefined ? undefined : objectLiteral(target, spread);
      if (spreadObject !== undefined) {
        entries.push(...registrationEntries(target, spreadObject, visited));
      }
      continue;
    }
    const name = conceptName(entry);
    const value = ts.isPropertyAssignment(entry)
      ? entry.initializer
      : ts.isShorthandPropertyAssignment(entry)
        ? entry.name
        : undefined;
    if (name !== undefined && value !== undefined) entries.push({ name, source, value });
  }
  return entries;
}

/** Locate only the class source needed for checks; runtime registration owns discovery and specs. */
export function registeredClassSources(conceptSetPath: string): RegisteredClassSource[] {
  const source = parse(conceptSetPath);
  const calls: ts.CallExpression[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "conceptSet"
    ) {
      calls.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  const result: RegisteredClassSource[] = [];
  for (const call of calls) {
    const registrations =
      call.arguments[0] === undefined ? undefined : objectLiteral(source, call.arguments[0]);
    if (registrations === undefined) continue;
    for (const entry of registrationEntries(source, registrations)) {
      const registration = registrationCall(entry.source, entry.value, new Set());
      if (registration === undefined) continue;
      const options =
        registration.call.arguments[0] === undefined
          ? undefined
          : objectLiteral(registration.source, registration.call.arguments[0]);
      const classValue = options === undefined ? undefined : property(options, "class");
      if (classValue === undefined) continue;
      const classIdentifier = unwrap(classValue);
      if (!ts.isIdentifier(classIdentifier)) continue;
      const imported = importsOf(registration.source).get(classIdentifier.text);
      if (imported === undefined || imported.imported === "default") continue;
      result.push({
        conceptName: entry.name,
        className: imported.imported,
        classPath: resolve(dirname(registration.source.fileName), imported.from),
      });
    }
  }
  return result;
}
