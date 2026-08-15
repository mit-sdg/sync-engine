import ts from "typescript";
import type {
  AuthoritativeComputationInput,
  ResolveComputationInputs,
} from "./authored-design-orchestration.ts";
import {
  shapeOfTypeNode,
  typeScriptSourceContext,
  type TypeScriptSourceContext,
} from "./typescript-shapes.ts";

type AnalysisContext = TypeScriptSourceContext;

type RegistrationKind = "conceptSet" | "vocabulary";

interface StaticValue {
  source: ts.SourceFile;
  expression: ts.Expression;
}

interface StaticMember extends StaticValue {
  name: string;
}

function fail(source: ts.SourceFile, detail: string): never {
  throw new Error(`Computation source analysis failed in ${source.fileName}: ${detail}`);
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

function keyOf(node: ts.Node): string {
  return `${node.getSourceFile().fileName}\0${node.pos}\0${node.end}`;
}

function variableValue(
  identifier: ts.Identifier,
  checker: ts.TypeChecker,
): StaticValue | undefined {
  const declaration = targetSymbol(identifier, checker)?.declarations?.find(
    ts.isVariableDeclaration,
  );
  return declaration?.initializer === undefined
    ? undefined
    : { source: declaration.getSourceFile(), expression: declaration.initializer };
}

function objectLiteral(
  value: StaticValue,
  context: AnalysisContext,
  active = new Set<string>(),
): { source: ts.SourceFile; object: ts.ObjectLiteralExpression } | undefined {
  const expression = unwrap(value.expression);
  if (ts.isObjectLiteralExpression(expression)) return { source: value.source, object: expression };
  if (!ts.isIdentifier(expression)) return undefined;
  const key = keyOf(expression);
  if (active.has(key)) fail(value.source, `the object alias \`${expression.text}\` is cyclic`);
  active.add(key);
  const target = variableValue(expression, context.checker);
  const result = target === undefined ? undefined : objectLiteral(target, context, active);
  active.delete(key);
  return result;
}

function staticName(member: ts.ObjectLiteralElementLike): string | undefined {
  if (!ts.isPropertyAssignment(member) && !ts.isShorthandPropertyAssignment(member)) {
    return undefined;
  }
  return ts.isIdentifier(member.name) || ts.isStringLiteral(member.name)
    ? member.name.text
    : undefined;
}

function staticMembers(
  source: ts.SourceFile,
  object: ts.ObjectLiteralExpression,
  context: AnalysisContext,
  active = new Set<string>(),
): Map<string, StaticMember> {
  const result = new Map<string, StaticMember>();
  for (const member of object.properties) {
    if (ts.isSpreadAssignment(member)) {
      const key = keyOf(member.expression);
      if (active.has(key)) fail(source, "a computation-map spread is cyclic");
      active.add(key);
      const spread = objectLiteral({ source, expression: member.expression }, context);
      if (spread === undefined) fail(source, "a computation-map spread is dynamic");
      for (const [name, entry] of staticMembers(spread.source, spread.object, context, active)) {
        result.set(name, entry);
      }
      active.delete(key);
      continue;
    }

    const name = staticName(member);
    if (name === undefined) fail(source, "a computation-map entry has a dynamic or computed name");
    if (!ts.isPropertyAssignment(member) && !ts.isShorthandPropertyAssignment(member)) {
      fail(source, "a computation-map entry is not a property assignment");
    }
    const expression = ts.isPropertyAssignment(member) ? member.initializer : member.name;
    result.set(name, { name, source, expression });
  }
  return result;
}

function propertyValue(
  source: ts.SourceFile,
  object: ts.ObjectLiteralExpression,
  name: string,
  context: AnalysisContext,
): StaticValue | undefined {
  for (let index = object.properties.length - 1; index >= 0; index -= 1) {
    const member = object.properties[index];
    if (ts.isSpreadAssignment(member)) {
      const spread = objectLiteral({ source, expression: member.expression }, context);
      if (spread === undefined) {
        fail(source, `the spread used to determine vocabulary property \`${name}\` is dynamic`);
      }
      const found = propertyValue(spread.source, spread.object, name, context);
      if (found !== undefined) return found;
      continue;
    }
    if (staticName(member) !== name) continue;
    if (ts.isPropertyAssignment(member)) return { source, expression: member.initializer };
    if (ts.isShorthandPropertyAssignment(member)) return { source, expression: member.name };
    fail(source, `vocabulary property \`${name}\` is not a static property assignment`);
  }
  return undefined;
}

function registrationKind(
  expression: ts.Expression,
  context: AnalysisContext,
  active = new Set<string>(),
): RegistrationKind | undefined {
  expression = unwrap(expression);
  if (!ts.isIdentifier(expression)) return undefined;
  if (expression.text === "conceptSet" || expression.text === "vocabulary") return expression.text;

  const key = keyOf(expression);
  if (active.has(key)) return undefined;
  active.add(key);
  const local = localSymbol(expression, context.checker);
  for (const declaration of local?.declarations ?? []) {
    if (ts.isImportSpecifier(declaration)) {
      const imported = declaration.propertyName?.text ?? declaration.name.text;
      if (imported === "conceptSet" || imported === "vocabulary") return imported;
    }
  }
  const target = variableValue(expression, context.checker);
  const result =
    target === undefined ? undefined : registrationKind(target.expression, context, active);
  active.delete(key);
  return result;
}

function computationsOf(
  call: ts.CallExpression,
  kind: RegistrationKind,
  context: AnalysisContext,
): Map<string, StaticMember> {
  let value: StaticValue | undefined;
  if (kind === "conceptSet") {
    const argument = call.arguments[1];
    if (argument === undefined) return new Map();
    value = { source: call.getSourceFile(), expression: argument };
  } else {
    const declarationArgument = call.arguments[0];
    if (declarationArgument === undefined)
      fail(call.getSourceFile(), "vocabulary(...) has no declaration object");
    const declaration = objectLiteral(
      { source: call.getSourceFile(), expression: declarationArgument },
      context,
    );
    if (declaration === undefined)
      fail(call.getSourceFile(), "the vocabulary declaration is dynamic");
    value = propertyValue(declaration.source, declaration.object, "computations", context);
    if (value === undefined) return new Map();
  }

  const object = objectLiteral(value, context);
  if (object === undefined) fail(value.source, "the selected computation map is dynamic");
  return staticMembers(object.source, object.object, context);
}

function functionLike(
  value: StaticValue,
  context: AnalysisContext,
  active = new Set<string>(),
): ts.FunctionLikeDeclaration | undefined {
  const expression = unwrap(value.expression);
  if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) {
    return expression;
  }
  if (!ts.isIdentifier(expression)) return undefined;
  const key = keyOf(expression);
  if (active.has(key)) fail(value.source, `the function alias \`${expression.text}\` is cyclic`);
  active.add(key);

  const symbol = targetSymbol(expression, context.checker);
  const declarations = (symbol?.declarations ?? []).filter(
    (declaration): declaration is ts.FunctionDeclaration => ts.isFunctionDeclaration(declaration),
  );
  if (declarations.length > 1) {
    fail(
      value.source,
      `the computation function \`${expression.text}\` has ambiguous declarations`,
    );
  }
  if (declarations.length === 1) {
    if (declarations[0].body === undefined) {
      fail(
        value.source,
        `the computation function \`${expression.text}\` has no source implementation`,
      );
    }
    return declarations[0];
  }

  const target = variableValue(expression, context.checker);
  const result = target === undefined ? undefined : functionLike(target, context, active);
  active.delete(key);
  return result;
}

function inputsOf(
  name: string,
  member: StaticMember,
  context: AnalysisContext,
): AuthoritativeComputationInput {
  const fn = functionLike(member, context);
  if (fn === undefined)
    fail(
      member.source,
      `computation \`${name}\` is not a statically resolved function declaration`,
    );
  if (fn.parameters.length === 0) return { name, inputs: [] };
  if (fn.parameters.length !== 1)
    fail(
      fn.getSourceFile(),
      `computation \`${name}\` must take zero parameters or one object parameter`,
    );
  const parameter = fn.parameters[0];
  if (
    parameter.dotDotDotToken !== undefined ||
    parameter.questionToken !== undefined ||
    parameter.initializer !== undefined
  ) {
    fail(
      fn.getSourceFile(),
      `computation \`${name}\` has a dynamic, optional, or defaulted parameter`,
    );
  }
  if (parameter.type === undefined)
    fail(fn.getSourceFile(), `computation \`${name}\` input type is not explicitly declared`);
  const shape = shapeOfTypeNode(parameter.type, fn, context);
  if (!shape.ok) {
    fail(
      shape.site.getSourceFile(),
      `computation \`${name}\` input shape cannot be resolved (${shape.operation}: ${shape.detail})`,
    );
  }
  return { name, inputs: shape.fields };
}

/**
 * Prove the input field names and optionality of the computations registered by one configured
 * configured concept-set module. Selection and source registration must agree exactly.
 */
export function authoritativeComputationInputs(
  conceptSetModulePath: string,
  selectedNames: readonly string[],
  suppliedContext?: TypeScriptSourceContext,
): readonly AuthoritativeComputationInput[] {
  const context = suppliedContext ?? typeScriptSourceContext(conceptSetModulePath);
  const calls: { call: ts.CallExpression; kind: RegistrationKind }[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const kind = registrationKind(node.expression, context);
      if (kind !== undefined) calls.push({ call: node, kind });
    }
    ts.forEachChild(node, visit);
  };
  visit(context.source);

  if (calls.length === 0)
    fail(context.source, "no static conceptSet(...) or vocabulary(...) declaration was found");
  if (calls.length > 1)
    fail(context.source, "multiple conceptSet(...) or vocabulary(...) declarations are ambiguous");

  const members = computationsOf(calls[0].call, calls[0].kind, context);
  const selected = new Set(selectedNames);
  if (selected.size !== selectedNames.length)
    fail(context.source, "selected computation names contain duplicates");
  const declaredNames = [...members.keys()].sort();
  const expectedNames = [...selected].sort();
  const extra = declaredNames.filter((name) => !selected.has(name));
  const missing = expectedNames.filter((name) => !members.has(name));
  if (extra.length > 0 || missing.length > 0) {
    const details = [
      ...(extra.length === 0 ? [] : [`extra declarations: ${extra.join(", ")}`]),
      ...(missing.length === 0 ? [] : [`missing declarations: ${missing.join(", ")}`]),
    ];
    fail(context.source, `selected computations do not match source (${details.join("; ")})`);
  }

  return expectedNames.map((name) => inputsOf(name, members.get(name)!, context));
}

/** Build the command-side adapter injected into authored-design orchestration. */
export function resolveComputationInputsFromSource(
  conceptSetModulePath: string,
): ResolveComputationInputs {
  return ({ computations }) =>
    authoritativeComputationInputs(
      conceptSetModulePath,
      computations.map(({ name }) => name),
    );
}
