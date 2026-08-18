import ts from "typescript";
import type { AnalysisController } from "../ir/analysis-foundation.ts";

export type PublicSourceApi =
  | "assemble"
  | "conceptSet"
  | "registerConcept"
  | "vocabulary"
  | "reaction"
  | "endpoint"
  | "endpointPrefix"
  | "view"
  | "former";

export type StaticResolutionReason =
  | "ambiguous"
  | "cycle"
  | "depth"
  | "dynamic"
  | "mutable"
  | "over-bound"
  | "unresolved-symbol";

export type StaticResolution<Value> =
  | { readonly kind: "resolved"; readonly value: Value }
  | { readonly kind: "missing" }
  | {
      readonly kind: "unresolved" | "ambiguous";
      readonly reason: StaticResolutionReason;
      readonly nodes: readonly ts.Node[];
    };

export interface StaticValue {
  readonly node: ts.Node;
  readonly substitutions: ReadonlyMap<ts.Symbol, StaticValue>;
}

export interface StaticProperty {
  readonly name: string;
  readonly value: StaticValue;
  readonly declaration: ts.Node;
  readonly nameNode?: ts.Node;
}

interface StaticObject {
  readonly entries: ReadonlyMap<string, StaticResolution<StaticProperty>>;
  readonly complete: boolean;
  readonly nodes: readonly ts.Node[];
}

export interface ApiRecognition {
  readonly api: PublicSourceApi;
  readonly resolution: "symbol" | "static-flow" | "literal-name";
}

const PUBLIC_APIS: Readonly<Record<string, ReadonlySet<PublicSourceApi>>> = {
  "@mit-sdg/sync-engine/assembly": new Set(["assemble", "conceptSet", "registerConcept"]),
  "@mit-sdg/sync-engine/advanced": new Set(["vocabulary"]),
  "@mit-sdg/sync-engine/boundary": new Set(["endpoint", "endpointPrefix"]),
  "@mit-sdg/sync-engine/language": new Set(["reaction", "view", "former"]),
};
const EMPTY: ReadonlyMap<ts.Symbol, StaticValue> = new Map();

function unwrap(node: ts.Node): ts.Node {
  while (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isTypeAssertionExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isPartiallyEmittedExpression(node)
  ) {
    node = node.expression;
  }
  return node;
}

function key(node: ts.Node, suffix = ""): string {
  return `${node.getSourceFile().fileName}:${node.pos}:${node.end}:${node.kind}:${suffix}`;
}

function unique(nodes: readonly ts.Node[]): ts.Node[] {
  return [...new Map(nodes.map((node) => [key(node), node])).values()];
}

function failed(
  reason: StaticResolutionReason,
  nodes: readonly ts.Node[],
): StaticResolution<never> {
  return {
    kind: reason === "ambiguous" ? "ambiguous" : "unresolved",
    reason,
    nodes: unique(nodes),
  };
}

function value(node: ts.Node, substitutions: ReadonlyMap<ts.Symbol, StaticValue>): StaticValue {
  return { node, substitutions };
}

function nameNode(name: ts.PropertyName): ts.Node {
  return ts.isComputedPropertyName(name) ? name.expression : name;
}

function isFunction(node: ts.Node): node is ts.FunctionLikeDeclaration {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node)
  );
}

/** Bounded checker-symbol and immutable-value resolution without evaluation. */
export class SourceResolver {
  private readonly checker: ts.TypeChecker;
  private readonly apiSymbols = new Map<ts.Symbol, PublicSourceApi>();
  private readonly fallbacks = new Map<ts.Symbol, PublicSourceApi>();

  constructor(
    program: ts.Program,
    private readonly controller: AnalysisController,
  ) {
    controller.checkpoint();
    this.checker = program.getTypeChecker();
    controller.checkpoint();
    for (const source of program.getSourceFiles()) {
      controller.checkpoint();
      this.collectApis(source);
    }
  }

  private checked<Value>(work: () => Value): Value {
    this.controller.checkpoint();
    const value = work();
    this.controller.checkpoint();
    return value;
  }

  private bounded(depth: number, nodes: readonly ts.Node[]): StaticResolution<never> | undefined {
    this.controller.checkpoint();
    return depth > this.controller.limits.maxStaticResolutionDepth
      ? failed("depth", nodes)
      : undefined;
  }

  private symbol(node: ts.Node): ts.Symbol | undefined {
    node = unwrap(node);
    const declaration = node as ts.NamedDeclaration;
    if (declaration.name !== undefined) {
      return this.checked(() => this.checker.getSymbolAtLocation(declaration.name!));
    }
    if (ts.isPropertyAccessExpression(node)) {
      return this.checked(() => this.checker.getSymbolAtLocation(node.name));
    }
    if (ts.isElementAccessExpression(node) && node.argumentExpression !== undefined) {
      return this.checked(() => this.checker.getSymbolAtLocation(node.argumentExpression!));
    }
    return this.checked(() => this.checker.getSymbolAtLocation(node));
  }

  private target(symbol: ts.Symbol | undefined): ts.Symbol | undefined {
    const seen = new Set<ts.Symbol>();
    for (let depth = 0; symbol !== undefined; depth += 1) {
      this.controller.checkpoint();
      if ((symbol.flags & ts.SymbolFlags.Alias) === 0) return symbol;
      if (seen.has(symbol) || depth >= this.controller.limits.maxStaticResolutionDepth) return;
      seen.add(symbol);
      const next = this.checked(() => this.checker.getAliasedSymbol(symbol!));
      if (next === symbol || next.name === "unknown") return;
      symbol = next;
    }
  }

  private collectApis(source: ts.SourceFile): void {
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue;
      const specifier = statement.moduleSpecifier;
      if (specifier === undefined || !ts.isStringLiteralLike(specifier)) continue;
      const supported = PUBLIC_APIS[specifier.text];
      if (supported === undefined) continue;
      const module = this.checked(() => this.checker.getSymbolAtLocation(specifier));
      if (module !== undefined) {
        for (const exported of this.checked(() => this.checker.getExportsOfModule(module))) {
          if (supported.has(exported.name as PublicSourceApi)) {
            this.apiSymbols.set(
              this.target(exported) ?? exported,
              exported.name as PublicSourceApi,
            );
          }
        }
      }
      if (!ts.isImportDeclaration(statement)) continue;
      const imports = statement.importClause?.namedBindings;
      if (imports === undefined || !ts.isNamedImports(imports)) continue;
      for (const binding of imports.elements) {
        const imported = binding.propertyName?.text ?? binding.name.text;
        const local = this.checked(() => this.checker.getSymbolAtLocation(binding.name));
        if (local !== undefined && supported.has(imported as PublicSourceApi)) {
          this.fallbacks.set(local, imported as PublicSourceApi);
        }
      }
    }
  }

  private api(symbol: ts.Symbol | undefined): PublicSourceApi | undefined {
    return symbol === undefined ? undefined : this.apiSymbols.get(this.target(symbol) ?? symbol);
  }

  apiOfCall(
    call: ts.CallExpression,
    substitutions: ReadonlyMap<ts.Symbol, StaticValue> = EMPTY,
  ): ApiRecognition | undefined {
    const direct = this.symbol(call.expression);
    const api = this.api(direct);
    if (api !== undefined) return { api, resolution: "symbol" };
    const fallback = direct === undefined ? undefined : this.fallbacks.get(direct);
    if (fallback !== undefined) return { api: fallback, resolution: "literal-name" };
    const resolved = this.resolve(value(call.expression, substitutions), 0, new Set());
    if (resolved.kind !== "resolved" || resolved.value.node === unwrap(call.expression)) return;
    const nested = ts.isCallExpression(resolved.value.node)
      ? this.apiOfCall(resolved.value.node, resolved.value.substitutions)
      : this.api(this.symbol(resolved.value.node));
    return nested === undefined
      ? undefined
      : { api: typeof nested === "string" ? nested : nested.api, resolution: "static-flow" };
  }

  value(node: ts.Node | StaticValue): StaticResolution<StaticValue> {
    return this.resolve("node" in node ? node : value(node, EMPTY), 0, new Set());
  }

  private resolve(
    input: StaticValue,
    depth: number,
    active: Set<string>,
  ): StaticResolution<StaticValue> {
    const bounded = this.bounded(depth, [input.node]);
    if (bounded !== undefined) return bounded;
    const node = unwrap(input.node);
    const id = key(node, `value:${input.substitutions.size}`);
    if (active.has(id)) return failed("cycle", [node]);
    if (ts.isConditionalExpression(node)) return failed("ambiguous", [node]);
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind >= ts.SyntaxKind.QuestionQuestionToken &&
      [
        ts.SyntaxKind.QuestionQuestionToken,
        ts.SyntaxKind.BarBarToken,
        ts.SyntaxKind.AmpersandAmpersandToken,
        ts.SyntaxKind.CommaToken,
      ].includes(node.operatorToken.kind)
    ) {
      return failed("dynamic", [node]);
    }
    active.add(id);
    try {
      if (ts.isIdentifier(node)) {
        const symbol = this.checked(() => this.checker.getSymbolAtLocation(node));
        const substituted = symbol === undefined ? undefined : input.substitutions.get(symbol);
        return substituted === undefined
          ? this.symbolValue(symbol, input.substitutions, depth + 1, active, node)
          : this.resolve(substituted, depth + 1, active);
      }
      if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
        const name = ts.isPropertyAccessExpression(node)
          ? node.name.text
          : node.argumentExpression === undefined
            ? undefined
            : this.string(value(node.argumentExpression, input.substitutions));
        if (name === undefined) return failed("dynamic", [node]);
        const symbol = this.symbol(node);
        if (this.moduleSymbol(node.expression) !== undefined && symbol !== undefined) {
          return this.symbolValue(symbol, input.substitutions, depth + 1, active, node);
        }
        const property = this.property(
          value(node.expression, input.substitutions),
          name,
          depth + 1,
        );
        return property.kind === "resolved"
          ? this.resolve(property.value.value, depth + 1, active)
          : property;
      }
      if (
        ts.isVariableDeclaration(node) ||
        ts.isBindingElement(node) ||
        ts.isParameter(node) ||
        ts.isPropertyAssignment(node) ||
        ts.isShorthandPropertyAssignment(node) ||
        ts.isPropertyDeclaration(node) ||
        ts.isExportAssignment(node)
      ) {
        return this.declarationValue(node, input.substitutions, depth + 1, active);
      }
      return { kind: "resolved", value: value(node, input.substitutions) };
    } finally {
      active.delete(id);
    }
  }

  private symbolValue(
    original: ts.Symbol | undefined,
    substitutions: ReadonlyMap<ts.Symbol, StaticValue>,
    depth: number,
    active: Set<string>,
    use: ts.Node,
  ): StaticResolution<StaticValue> {
    if (original === undefined) return failed("unresolved-symbol", [use]);
    const symbol = this.target(original);
    if (symbol === undefined) return failed("unresolved-symbol", [use]);
    const substituted = substitutions.get(original) ?? substitutions.get(symbol);
    if (substituted !== undefined) return this.resolve(substituted, depth + 1, active);
    if (this.api(symbol) !== undefined)
      return { kind: "resolved", value: value(use, substitutions) };
    let declarations = (symbol.declarations ?? []).filter(
      (node) =>
        !ts.isInterfaceDeclaration(node) &&
        !ts.isTypeAliasDeclaration(node) &&
        (!isFunction(node) || node.body !== undefined),
    );
    if (symbol.valueDeclaration !== undefined) declarations = [symbol.valueDeclaration];
    declarations = unique(declarations) as ts.Declaration[];
    if (declarations.length !== 1) {
      return failed(
        declarations.length === 0 ? "unresolved-symbol" : "ambiguous",
        declarations.length === 0 ? [use] : declarations,
      );
    }
    return this.declarationValue(declarations[0], substitutions, depth + 1, active);
  }

  private declarationValue(
    node: ts.Declaration,
    substitutions: ReadonlyMap<ts.Symbol, StaticValue>,
    depth: number,
    active: Set<string>,
  ): StaticResolution<StaticValue> {
    if (ts.isVariableDeclaration(node)) {
      const list = ts.isVariableDeclarationList(node.parent) ? node.parent : undefined;
      if (list === undefined || (list.flags & ts.NodeFlags.Const) === 0)
        return failed("mutable", [node]);
      return node.initializer === undefined
        ? failed("dynamic", [node])
        : this.resolve(value(node.initializer, substitutions), depth + 1, active);
    }
    if (ts.isBindingElement(node)) {
      if (node.dotDotDotToken !== undefined) return failed("dynamic", [node]);
      const source = this.bindingSource(node, substitutions);
      if (source === undefined) return failed("dynamic", [node]);
      const name = node.propertyName ?? node.name;
      if (!ts.isIdentifier(name) && !ts.isStringLiteralLike(name) && !ts.isNumericLiteral(name)) {
        return failed("dynamic", [node]);
      }
      const property = this.property(source, name.text, depth + 1);
      return property.kind === "resolved"
        ? this.resolve(property.value.value, depth + 1, active)
        : property.kind === "missing" && node.initializer !== undefined
          ? this.resolve(value(node.initializer, substitutions), depth + 1, active)
          : property;
    }
    if (ts.isParameter(node)) {
      const symbol = ts.isIdentifier(node.name)
        ? this.checked(() => this.checker.getSymbolAtLocation(node.name))
        : undefined;
      const selected = symbol === undefined ? undefined : substitutions.get(symbol);
      if (selected !== undefined) return this.resolve(selected, depth + 1, active);
      return node.initializer === undefined
        ? failed("dynamic", [node])
        : this.resolve(value(node.initializer, substitutions), depth + 1, active);
    }
    if (ts.isPropertyAssignment(node))
      return this.resolve(value(node.initializer, substitutions), depth + 1, active);
    if (ts.isShorthandPropertyAssignment(node)) {
      return this.symbolValue(
        this.checked(() => this.checker.getShorthandAssignmentValueSymbol(node)),
        substitutions,
        depth + 1,
        active,
        node,
      );
    }
    if (ts.isPropertyDeclaration(node)) {
      return node.initializer === undefined
        ? failed("dynamic", [node])
        : this.resolve(value(node.initializer, substitutions), depth + 1, active);
    }
    if (ts.isExportAssignment(node))
      return this.resolve(value(node.expression, substitutions), depth + 1, active);
    return { kind: "resolved", value: value(node, substitutions) };
  }

  private bindingSource(
    binding: ts.BindingElement,
    substitutions: ReadonlyMap<ts.Symbol, StaticValue>,
  ): StaticValue | undefined {
    let pattern: ts.Node = binding.parent;
    while (ts.isBindingElement(pattern.parent)) pattern = pattern.parent.parent;
    const owner = pattern.parent;
    if (ts.isVariableDeclaration(owner)) {
      const list = ts.isVariableDeclarationList(owner.parent) ? owner.parent : undefined;
      return list !== undefined &&
        (list.flags & ts.NodeFlags.Const) !== 0 &&
        owner.initializer !== undefined
        ? value(owner.initializer, substitutions)
        : undefined;
    }
    if (!ts.isParameter(owner)) return;
    const symbol = ts.isIdentifier(owner.name)
      ? this.checked(() => this.checker.getSymbolAtLocation(owner.name))
      : undefined;
    return (
      (symbol === undefined ? undefined : substitutions.get(symbol)) ??
      (owner.initializer === undefined ? undefined : value(owner.initializer, substitutions))
    );
  }

  private moduleSymbol(node: ts.Node): ts.Symbol | undefined {
    const symbol = this.target(this.symbol(unwrap(node)));
    return symbol !== undefined &&
      (symbol.flags & (ts.SymbolFlags.Module | ts.SymbolFlags.Namespace)) !== 0
      ? symbol
      : undefined;
  }

  string(
    node: ts.Node | StaticValue,
    substitutions: ReadonlyMap<ts.Symbol, StaticValue> = EMPTY,
    depth = 0,
  ): string | undefined {
    if (this.bounded(depth, ["node" in node ? node.node : node]) !== undefined) return;
    const resolved = this.value("node" in node ? node : value(node, substitutions));
    if (resolved.kind !== "resolved") return;
    const current = unwrap(resolved.value.node);
    return ts.isStringLiteralLike(current) || ts.isNumericLiteral(current)
      ? current.text
      : undefined;
  }

  property(node: ts.Node | StaticValue, name: string, depth = 0): StaticResolution<StaticProperty> {
    const object = this.object(node, depth + 1);
    if (object.kind !== "resolved") return object;
    return (
      object.value.entries.get(name) ??
      (object.value.complete ? { kind: "missing" } : failed("dynamic", object.value.nodes))
    );
  }

  object(node: ts.Node | StaticValue, depth = 0): StaticResolution<StaticObject> {
    const input = "node" in node ? node : value(node, EMPTY);
    const bounded = this.bounded(depth, [input.node]);
    if (bounded !== undefined) return bounded;
    const resolved = this.resolve(input, depth + 1, new Set());
    if (resolved.kind !== "resolved") return resolved;
    const current = unwrap(resolved.value.node);
    if (ts.isCallExpression(current)) {
      const returned = this.returnedValue(current, resolved.value.substitutions, depth + 1);
      return returned.kind === "resolved" ? this.object(returned.value, depth + 1) : returned;
    }
    const module = this.moduleSymbol(current);
    if (module !== undefined)
      return this.moduleObject(module, resolved.value.substitutions, depth + 1);
    if (!ts.isObjectLiteralExpression(current)) return failed("dynamic", [current]);
    const entries = new Map<string, StaticResolution<StaticProperty>>();
    let complete = true;
    const uncertain: ts.Node[] = [];
    for (const property of current.properties) {
      this.controller.checkpoint();
      if (ts.isSpreadAssignment(property)) {
        const spread = this.object(
          value(property.expression, resolved.value.substitutions),
          depth + 1,
        );
        if (spread.kind !== "resolved") {
          complete = false;
          uncertain.push(...("nodes" in spread ? spread.nodes : [property]));
          for (const name of entries.keys()) entries.set(name, failed("ambiguous", [property]));
        } else {
          for (const [name, entry] of spread.value.entries) entries.set(name, entry);
          complete &&= spread.value.complete;
          if (!spread.value.complete) uncertain.push(...spread.value.nodes);
        }
        continue;
      }
      if (
        !ts.isPropertyAssignment(property) &&
        !ts.isShorthandPropertyAssignment(property) &&
        !ts.isMethodDeclaration(property) &&
        !ts.isGetAccessorDeclaration(property)
      ) {
        complete = false;
        uncertain.push(property);
        continue;
      }
      const name = this.propertyName(property.name, resolved.value.substitutions);
      if (name === undefined) {
        complete = false;
        uncertain.push(property);
        continue;
      }
      entries.set(name, {
        kind: "resolved",
        value: {
          name,
          value: value(
            ts.isPropertyAssignment(property) ? property.initializer : property,
            resolved.value.substitutions,
          ),
          declaration: property,
          nameNode: nameNode(property.name),
        },
      });
    }
    if (entries.size > this.controller.limits.maxStaticResolutionAlternatives) {
      return failed("over-bound", [current]);
    }
    return {
      kind: "resolved",
      value: { entries, complete, nodes: unique(uncertain.length === 0 ? [current] : uncertain) },
    };
  }

  private moduleObject(
    module: ts.Symbol,
    substitutions: ReadonlyMap<ts.Symbol, StaticValue>,
    depth: number,
  ): StaticResolution<StaticObject> {
    const exports = this.checked(() => this.checker.getExportsOfModule(module));
    if (exports.length > this.controller.limits.maxStaticResolutionAlternatives) {
      return failed("over-bound", module.declarations ?? []);
    }
    const entries = new Map<string, StaticResolution<StaticProperty>>();
    for (const exported of exports) {
      const target = this.target(exported) ?? exported;
      const declaration =
        exported.declarations?.[0] ?? target.valueDeclaration ?? target.declarations?.[0];
      if (
        declaration === undefined ||
        (target.valueDeclaration === undefined && (target.flags & ts.SymbolFlags.Module) === 0)
      )
        continue;
      const resolved = this.symbolValue(exported, substitutions, depth + 1, new Set(), declaration);
      entries.set(
        exported.name,
        resolved.kind === "resolved"
          ? {
              kind: "resolved",
              value: {
                name: exported.name,
                value: resolved.value,
                declaration,
                ...((declaration as ts.NamedDeclaration).name !== undefined
                  ? {
                      nameNode: nameNode(
                        (declaration as ts.NamedDeclaration).name as ts.PropertyName,
                      ),
                    }
                  : {}),
              },
            }
          : resolved,
      );
    }
    return {
      kind: "resolved",
      value: { entries, complete: true, nodes: module.declarations ?? [] },
    };
  }

  private propertyName(
    name: ts.PropertyName,
    substitutions: ReadonlyMap<ts.Symbol, StaticValue>,
  ): string | undefined {
    if (
      ts.isIdentifier(name) ||
      ts.isPrivateIdentifier(name) ||
      ts.isStringLiteralLike(name) ||
      ts.isNumericLiteral(name)
    ) {
      return name.text;
    }
    return ts.isComputedPropertyName(name)
      ? this.string(value(name.expression, substitutions))
      : undefined;
  }

  returnedValue(
    call: ts.CallExpression,
    substitutions: ReadonlyMap<ts.Symbol, StaticValue> = EMPTY,
    depth = 0,
  ): StaticResolution<StaticValue> {
    if (this.apiOfCall(call, substitutions) !== undefined) return failed("dynamic", [call]);
    const callable = this.value(value(call.expression, substitutions));
    return callable.kind === "resolved"
      ? this.returnOfFunction(
          callable.value,
          call.arguments.map((argument) => value(argument, substitutions)),
          depth + 1,
        )
      : callable;
  }

  returnOfFunction(
    node: ts.Node | StaticValue,
    args: readonly StaticValue[] = [],
    depth = 0,
  ): StaticResolution<StaticValue> {
    const resolved = this.value(node);
    if (resolved.kind !== "resolved") return resolved;
    const fn = resolved.value.node;
    if (!isFunction(fn)) return failed("dynamic", [fn]);
    const substitutions = new Map(resolved.value.substitutions);
    for (const [index, parameter] of fn.parameters.entries()) {
      this.bind(parameter, args[index], substitutions, depth + 1);
    }
    if (ts.isArrowFunction(fn) && !ts.isBlock(fn.body))
      return this.value(value(fn.body, substitutions));
    if (fn.body === undefined || !ts.isBlock(fn.body)) return failed("dynamic", [fn]);
    const returns: ts.ReturnStatement[] = [];
    const visit = (current: ts.Node): void => {
      this.controller.checkpoint();
      if (current !== fn.body && ts.isFunctionLike(current)) return;
      if (ts.isReturnStatement(current)) returns.push(current);
      else ts.forEachChild(current, visit);
    };
    visit(fn.body);
    if (returns.length !== 1 || returns[0].expression === undefined) {
      return failed(
        returns.length > 1 ? "ambiguous" : "dynamic",
        returns.length === 0 ? [fn] : returns,
      );
    }
    for (let ancestor = returns[0].parent; ancestor !== fn.body; ancestor = ancestor.parent) {
      if (
        ts.isIfStatement(ancestor) ||
        ts.isSwitchStatement(ancestor) ||
        ts.isIterationStatement(ancestor, false) ||
        ts.isTryStatement(ancestor)
      ) {
        return failed("ambiguous", returns);
      }
    }
    return this.value(value(returns[0].expression, substitutions));
  }

  private bind(
    parameter: ts.ParameterDeclaration,
    argument: StaticValue | undefined,
    substitutions: Map<ts.Symbol, StaticValue>,
    depth: number,
  ): void {
    const selected =
      argument ??
      (parameter.initializer === undefined
        ? undefined
        : value(parameter.initializer, substitutions));
    if (selected === undefined) return;
    if (ts.isIdentifier(parameter.name)) {
      const symbol = this.checked(() => this.checker.getSymbolAtLocation(parameter.name));
      if (symbol !== undefined) substitutions.set(symbol, selected);
      return;
    }
    if (!ts.isObjectBindingPattern(parameter.name)) return;
    for (const binding of parameter.name.elements) {
      const name = binding.propertyName ?? binding.name;
      const symbol = ts.isIdentifier(binding.name)
        ? this.checked(() => this.checker.getSymbolAtLocation(binding.name))
        : undefined;
      if (
        binding.dotDotDotToken === undefined &&
        symbol !== undefined &&
        (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name))
      ) {
        const property = this.property(selected, name.text, depth + 1);
        if (property.kind === "resolved") substitutions.set(symbol, property.value.value);
      }
    }
  }

  concreteClassMember(
    classValue: ts.Node | StaticValue,
    name: string,
  ): StaticResolution<ts.ClassElement> {
    const resolved = this.value(classValue);
    return resolved.kind === "resolved"
      ? this.classMember(resolved.value, name, 0, new Set())
      : resolved;
  }

  private classMember(
    classValue: StaticValue,
    name: string,
    depth: number,
    active: Set<string>,
  ): StaticResolution<ts.ClassElement> {
    const bounded = this.bounded(depth, [classValue.node]);
    if (bounded !== undefined) return bounded;
    const node = unwrap(classValue.node);
    if (!ts.isClassDeclaration(node) && !ts.isClassExpression(node))
      return failed("dynamic", [node]);
    const id = key(node, `member:${name}`);
    if (active.has(id)) return failed("cycle", [node]);
    active.add(id);
    try {
      const own = node.members.filter((member) => {
        if (
          member.name === undefined ||
          this.propertyName(member.name, classValue.substitutions) !== name
        )
          return false;
        return ts.isMethodDeclaration(member)
          ? member.body !== undefined
          : ts.isPropertyDeclaration(member)
            ? member.initializer !== undefined
            : (ts.isGetAccessorDeclaration(member) || ts.isSetAccessorDeclaration(member)) &&
              member.body !== undefined;
      });
      if (own.length !== 0)
        return own.length === 1 ? { kind: "resolved", value: own[0] } : failed("ambiguous", own);
      const heritage = node.heritageClauses?.find(
        ({ token }) => token === ts.SyntaxKind.ExtendsKeyword,
      );
      if (heritage === undefined) return { kind: "missing" };
      if (heritage.types.length !== 1) return failed("ambiguous", heritage.types);
      const base = this.value(value(heritage.types[0].expression, classValue.substitutions));
      return base.kind === "resolved"
        ? this.classMember(base.value, name, depth + 1, active)
        : base;
    } finally {
      active.delete(id);
    }
  }
}
