import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import {
  parseConceptSpecification,
  validateApplicationManifest,
  type ApplicationManifestV5,
  type ConceptSpecificationIR,
} from "@mit-sdg/sync-engine/tooling";
import ts from "typescript";
import {
  designRefKey,
  indexApplicationWithController,
  type ApplicationIndex,
  type DesignRef,
} from "../ir/application-impact.ts";
import {
  AnalysisController,
  AnalysisLimitError,
  usageDelta,
  type AnalysisOptions,
} from "../ir/analysis-foundation.ts";
import { analysisProvenance, freezeAnalysisData } from "../ir/analysis-provenance.ts";
import type {
  ApplicationSourceIndex,
  IndexedSourceDocument,
  SourceAnchor,
  SourceIndexIssue,
  SourceIndexIssueCode,
  SourcePosition,
  SourceRange,
  SourceResolution,
  SourceRole,
} from "../ir/source-data.ts";
import {
  SourceResolver,
  type ApiRecognition,
  type PublicSourceApi,
  type StaticProperty,
  type StaticResolution,
  type StaticValue,
} from "./source-resolver.ts";

export interface SourceAttributionRoot {
  /** Project-relative POSIX source path. */
  readonly path: string;
  /** Exact module export to trace. */
  readonly exportName?: string;
  /** UTF-16 position to trace. */
  readonly offset?: number;
}

export interface IndexApplicationSourcesOptions<
  Programs extends ts.Program | readonly ts.Program[] = ts.Program,
> extends AnalysisOptions {
  readonly manifest: ApplicationManifestV5;
  /** One program or a deterministic project-graph order of programs. */
  readonly program: Programs;
  readonly projectRoot: string;
  readonly readFile?: (absolutePath: string) => string | undefined;
  readonly sourceRoots?: readonly SourceAttributionRoot[];
}

type SourceInput = ts.Node | StaticValue;

interface CallCandidate {
  readonly api: PublicSourceApi;
  readonly recognition: ApiRecognition;
  readonly call: ts.CallExpression;
  readonly semantic: ts.Node;
  readonly focus: ts.Node;
}

interface SourceProgramContext {
  readonly program: ts.Program;
  readonly checker: ts.TypeChecker;
  readonly resolver: SourceResolver;
  readonly roots: ReadonlySet<string>;
}

interface VocabularyOrigin {
  readonly kind: "vocabulary" | "concept-set";
  readonly call: ts.CallExpression;
  readonly resolution: SourceResolution;
}

interface CompositionCandidate {
  readonly name: string;
  readonly candidate: CallCandidate;
}

interface RegistrationSource {
  readonly call: ts.CallExpression;
  readonly candidate: CallCandidate;
  readonly object: SourceInput;
}

interface ConceptSource {
  readonly declaration: StaticProperty;
  readonly registration?: RegistrationSource;
  readonly canonical?: SourceInput;
}

const DECLARATION_APIS = new Set<PublicSourceApi>(["reaction", "endpoint", "view", "former"]);
const EMPTY_SUBSTITUTIONS: ReadonlyMap<ts.Symbol, StaticValue> = new Map();

function ordinal(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function portablePath(path: string): string {
  return path.split(sep).join("/");
}

function projectPath(projectRoot: string, fileName: string): string | undefined {
  const path = relative(projectRoot, resolve(fileName));
  return path !== "" && !path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path)
    ? portablePath(path)
    : undefined;
}

function canonicalPath(path: string): string {
  const absolute = resolve(path);
  return ts.sys.fileExists(absolute) || ts.sys.directoryExists(absolute)
    ? realpathSync(absolute)
    : absolute;
}

function canonicalSourcePath(projectRoot: string, fileName: string): string | undefined {
  return projectPath(projectRoot, canonicalPath(fileName));
}

function validSourcePath(path: unknown, label: string): asserts path is string {
  if (
    typeof path !== "string" ||
    path === "" ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.endsWith("/") ||
    path.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new TypeError(`${label} must be an explicit relative POSIX file path`);
  }
}

function nonNegativeInteger(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer`);
  }
}

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

function staticValue(
  node: ts.Node,
  substitutions: ReadonlyMap<ts.Symbol, StaticValue> = EMPTY_SUBSTITUTIONS,
): StaticValue {
  return { node, substitutions };
}

function inputNode(input: SourceInput): ts.Node {
  return "node" in input ? input.node : input;
}

function inputSubstitutions(input: SourceInput): ReadonlyMap<ts.Symbol, StaticValue> {
  return "node" in input ? input.substitutions : EMPTY_SUBSTITUTIONS;
}

function nodeKey(node: ts.Node): string {
  return `${node.getSourceFile().fileName}:${node.pos}:${node.end}:${node.kind}`;
}

function rangeKey(range: SourceRange): string {
  return `${range.path}:${range.start.offset}:${range.end.offset}`;
}

function anchorKey(anchor: SourceAnchor): string {
  return JSON.stringify([
    anchor.role,
    anchor.range.path,
    anchor.range.start.offset,
    anchor.range.end.offset,
    anchor.focusRange?.start.offset ?? -1,
    anchor.focusRange?.end.offset ?? -1,
    anchor.resolution,
  ]);
}

function issueKey(issue: SourceIndexIssue): string {
  return JSON.stringify([
    issue.code,
    issue.severity,
    issue.ref === undefined ? "" : designRefKey(issue.ref),
    issue.role ?? "",
    issue.message,
    issue.candidates?.map(rangeKey) ?? [],
  ]);
}

function sourcePosition(source: ts.SourceFile, offset: number): SourcePosition {
  const position = source.getLineAndCharacterOfPosition(offset);
  return { offset, line: position.line + 1, column: position.character + 1 };
}

function textPosition(text: string, offset: number): SourcePosition {
  let line = 1;
  let lineStart = 0;
  for (let index = 0; index < offset; index += 1) {
    if (text.charCodeAt(index) === 10) {
      line += 1;
      lineStart = index + 1;
    }
  }
  return { offset, line, column: offset - lineStart + 1 };
}

function rangeForNode(projectRoot: string, node: ts.Node): SourceRange | undefined {
  const source = node.getSourceFile();
  const path = canonicalSourcePath(projectRoot, source.fileName);
  if (path === undefined) return undefined;
  const start = node.getStart(source);
  const end = node.getEnd();
  return { path, start: sourcePosition(source, start), end: sourcePosition(source, end) };
}

function rangeForText(path: string, text: string, start: number, end: number): SourceRange {
  return { path, start: textPosition(text, start), end: textPosition(text, end) };
}

function contains(outer: ts.Node, inner: ts.Node): boolean {
  return (
    outer.getSourceFile() === inner.getSourceFile() &&
    outer.pos <= inner.pos &&
    inner.end <= outer.end
  );
}

function namedFocus(node: ts.Node): ts.Node | undefined {
  if (ts.isVariableStatement(node)) {
    const declaration = node.declarationList.declarations[0];
    return declaration !== undefined && ts.isIdentifier(declaration.name)
      ? declaration.name
      : undefined;
  }
  if (
    ts.isPropertyAssignment(node) ||
    ts.isShorthandPropertyAssignment(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isClassDeclaration(node) ||
    ts.isClassExpression(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isVariableDeclaration(node) ||
    ts.isPropertyDeclaration(node)
  ) {
    return node.name;
  }
  return undefined;
}

function semanticDeclaration(call: ts.CallExpression): ts.Node {
  let functionOwner: ts.Node | undefined;
  for (let current = call.parent; current !== undefined; current = current.parent) {
    if (
      ts.isPropertyAssignment(current) ||
      ts.isShorthandPropertyAssignment(current) ||
      ts.isExportAssignment(current)
    ) {
      return current;
    }
    if (ts.isVariableDeclaration(current)) {
      return ts.isVariableDeclarationList(current.parent) &&
        ts.isVariableStatement(current.parent.parent)
        ? current.parent.parent
        : current;
    }
    if (
      ts.isFunctionDeclaration(current) ||
      ts.isMethodDeclaration(current) ||
      ts.isFunctionExpression(current) ||
      ts.isArrowFunction(current)
    ) {
      functionOwner ??= current;
    }
    if (ts.isSourceFile(current)) break;
  }
  return functionOwner ?? call;
}

function focusForCall(call: ts.CallExpression, semantic: ts.Node): ts.Node {
  const named = namedFocus(semantic);
  if (named !== undefined && contains(semantic, named)) return named;
  const first = call.arguments[0];
  return first !== undefined && ts.isStringLiteralLike(unwrap(first))
    ? unwrap(first)
    : call.expression;
}

function targetSymbol(
  checker: ts.TypeChecker,
  original: ts.Symbol | undefined,
  controller: AnalysisController,
): ts.Symbol | undefined {
  const seen = new Set<ts.Symbol>();
  let symbol = original;
  while (symbol !== undefined && (symbol.flags & ts.SymbolFlags.Alias) !== 0) {
    controller.checkpoint();
    if (seen.has(symbol)) return undefined;
    seen.add(symbol);
    const next = checker.getAliasedSymbol(symbol);
    controller.checkpoint();
    if (next === symbol || next.name === "unknown") return undefined;
    symbol = next;
  }
  return symbol;
}

function propertyAccessName(node: ts.Node, resolver: SourceResolver): string | undefined {
  node = unwrap(node);
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isElementAccessExpression(node) && node.argumentExpression !== undefined) {
    return resolver.string(node.argumentExpression);
  }
  return undefined;
}

function sameJson(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => sameJson(value, right[index]))
    );
  }
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object") {
    return false;
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord);
  const rightKeys = Object.keys(rightRecord);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key) => Object.hasOwn(rightRecord, key) && sameJson(leftRecord[key], rightRecord[key]),
    )
  );
}

function sameSpecification(
  manifest: ConceptSpecificationIR | undefined,
  source: ConceptSpecificationIR,
): boolean {
  return manifest === undefined || sameJson(manifest, source);
}

function reactionFamilyBase(name: string): string {
  const marker = name.indexOf("#");
  return marker < 0 ? name : name.slice(0, marker);
}

function sourceResolution(recognition: ApiRecognition): SourceResolution {
  return recognition.resolution;
}

/** Attribute one manifest's logical design references to bounded source slices. */
export function indexApplicationSources<Programs extends ts.Program | readonly ts.Program[]>(
  options: IndexApplicationSourcesOptions<Programs>,
): ApplicationSourceIndex {
  const controller = new AnalysisController(options);
  const applicationIndex = indexApplicationWithController(options.manifest, controller);
  return indexApplicationSourcesWithController(options, applicationIndex, controller);
}

export function indexApplicationSourcesWithController<
  Programs extends ts.Program | readonly ts.Program[],
>(
  options: IndexApplicationSourcesOptions<Programs>,
  applicationIndex: ApplicationIndex,
  controller: AnalysisController,
): ApplicationSourceIndex {
  controller.checkpoint();
  validateApplicationManifest(options.manifest);
  if (applicationIndex.manifestDigest !== options.manifest.digest) {
    throw new Error("applicationIndex belongs to a different application manifest");
  }
  if (options.readFile !== undefined && typeof options.readFile !== "function") {
    throw new TypeError("readFile must be a function when supplied");
  }
  const before = controller.usage();
  const { manifest } = options;
  const suppliedPrograms = Array.isArray(options.program)
    ? [...options.program]
    : [options.program as ts.Program];
  if (suppliedPrograms.length === 0) {
    throw new TypeError("program must contain at least one TypeScript program");
  }
  const programs = [...new Set(suppliedPrograms)].sort((left, right) => {
    const key = (program: ts.Program): string =>
      JSON.stringify([
        program.getCompilerOptions().configFilePath ?? "",
        [...program.getRootFileNames()].sort(ordinal),
      ]);
    return ordinal(key(left), key(right));
  });
  const projectRoot = canonicalPath(options.projectRoot);
  const readFile = options.readFile ?? ts.sys.readFile;
  const contextBySource = new WeakMap<ts.SourceFile, SourceProgramContext>();
  const contexts = programs.map((program): SourceProgramContext => {
    controller.checkpoint();
    const checker = program.getTypeChecker();
    controller.checkpoint();
    const resolver = new SourceResolver(program, controller);
    const context: SourceProgramContext = {
      program,
      checker,
      resolver,
      roots: new Set(program.getRootFileNames().map((fileName: string) => resolve(fileName))),
    };
    for (const source of program.getSourceFiles()) contextBySource.set(source, context);
    return context;
  });
  const selectedSources = new Map<
    string,
    {
      readonly source: ts.SourceFile;
      readonly context: SourceProgramContext;
      readonly root: boolean;
    }
  >();
  for (const context of contexts) {
    for (const source of context.program.getSourceFiles()) {
      controller.checkpoint();
      if (source.isDeclarationFile) continue;
      const path = canonicalSourcePath(projectRoot, source.fileName);
      if (path === undefined) continue;
      const root = context.roots.has(resolve(source.fileName));
      const previous = selectedSources.get(path);
      if (previous === undefined || (!previous.root && root)) {
        selectedSources.set(path, { source, context, root });
      }
    }
  }
  const sourceFiles = [...selectedSources.entries()]
    .sort(([left], [right]) => ordinal(left, right))
    .map(([, { source }]) => source);
  const contextFor = (node: ts.Node): SourceProgramContext => {
    const context = contextBySource.get(node.getSourceFile());
    if (context === undefined)
      throw new Error("source node belongs to no supplied TypeScript program");
    return context;
  };
  const resolverFor = (input: SourceInput): SourceResolver => contextFor(inputNode(input)).resolver;
  const checkerFor = (node: ts.Node): ts.TypeChecker => contextFor(node).checker;
  const sourceByPath = new Map(
    sourceFiles.map((source) => [canonicalSourcePath(projectRoot, source.fileName)!, source]),
  );
  const entries = new Map(
    applicationIndex.inventory.map((ref) => [
      designRefKey(ref),
      { ref, sources: new Map<string, SourceAnchor>() },
    ]),
  );
  const documents = new Map<string, IndexedSourceDocument>();
  const issues = new Map<string, SourceIndexIssue>();
  const calls: CallCandidate[] = [];
  const callKeys = new Set<string>();
  const callsByNode = new Map<string, CallCandidate>();
  let astCandidates = 0;

  const addDocument = (path: string, text: string): void => {
    if (documents.has(path)) return;
    controller.addSourceDocument();
    documents.set(path, {
      path,
      digest: sha256(text),
      length: text.length,
      byteLength: Buffer.byteLength(text, "utf8"),
    });
  };

  const report = (issue: SourceIndexIssue): void => {
    const key = issueKey(issue);
    if (issues.has(key)) return;
    controller.addDiagnostic();
    issues.set(key, issue);
  };

  const reportFor = (
    code: SourceIndexIssueCode,
    message: string,
    ref?: DesignRef,
    role?: SourceRole,
    candidates?: readonly SourceRange[],
  ): void => {
    report({
      code,
      severity: "warning",
      message,
      ...(ref === undefined ? {} : { ref }),
      ...(role === undefined ? {} : { role }),
      ...(candidates === undefined || candidates.length === 0 ? {} : { candidates }),
    });
  };

  const add = (ref: DesignRef, anchor: SourceAnchor | undefined): void => {
    if (anchor === undefined) return;
    const entry = entries.get(designRefKey(ref));
    if (entry === undefined) return;
    const key = anchorKey(anchor);
    if (entry.sources.has(key)) return;
    controller.addSourceAnchor();
    entry.sources.set(key, anchor);
  };

  const anchorForNode = (
    node: ts.Node,
    role: SourceRole,
    resolution: SourceResolution,
    focus?: ts.Node,
  ): SourceAnchor | undefined => {
    const range = rangeForNode(projectRoot, node);
    if (range === undefined) return undefined;
    const source = node.getSourceFile();
    addDocument(range.path, source.text);
    const text = source.text.slice(range.start.offset, range.end.offset);
    const focusRange =
      focus !== undefined && contains(node, focus) ? rangeForNode(projectRoot, focus) : undefined;
    return {
      role,
      range,
      digest: sha256(text),
      resolution,
      ...(focusRange === undefined ? {} : { focusRange }),
    };
  };

  const rangesForNodes = (nodes: readonly ts.Node[]): SourceRange[] =>
    [
      ...new Map(
        nodes.flatMap((node) => {
          const range = rangeForNode(projectRoot, node);
          return range === undefined ? [] : [[rangeKey(range), range] as const];
        }),
      ).values(),
    ].sort((left, right) => ordinal(rangeKey(left), rangeKey(right)));

  for (const source of sourceFiles) {
    const path = canonicalSourcePath(projectRoot, source.fileName)!;
    addDocument(path, source.text);
    const visit = (node: ts.Node): void => {
      controller.checkpoint();
      controller.addAstNode();
      astCandidates += 1;
      if (astCandidates > controller.limits.maxAstCandidates) {
        throw new AnalysisLimitError(
          "maxAstCandidates",
          controller.limits.maxAstCandidates,
          astCandidates,
        );
      }
      if (ts.isCallExpression(node)) {
        const recognition = resolverFor(node).apiOfCall(node);
        if (recognition !== undefined) {
          const semantic = semanticDeclaration(node);
          const candidate: CallCandidate = {
            api: recognition.api,
            recognition,
            call: node,
            semantic,
            focus: focusForCall(node, semantic),
          };
          const key = `${nodeKey(node)}:${recognition.api}`;
          if (!callKeys.has(key)) {
            callKeys.add(key);
            calls.push(candidate);
            callsByNode.set(nodeKey(node), candidate);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }

  const publicCall = (
    input: SourceInput,
    expected: ReadonlySet<PublicSourceApi>,
    depth = 0,
    active = new Set<string>(),
  ): StaticResolution<CallCandidate> => {
    controller.checkpoint();
    if (depth > controller.limits.maxStaticResolutionDepth) {
      return { kind: "unresolved", reason: "depth", nodes: [inputNode(input)] };
    }
    const key = `${nodeKey(inputNode(input))}:${[...expected].join(",")}`;
    if (active.has(key)) {
      return { kind: "unresolved", reason: "cycle", nodes: [inputNode(input)] };
    }
    active.add(key);
    try {
      const resolver = resolverFor(input);
      const resolved = resolver.value(input);
      if (resolved.kind !== "resolved") return resolved;
      const node = unwrap(resolved.value.node);
      if (ts.isCallExpression(node)) {
        const recognition = resolver.apiOfCall(node, resolved.value.substitutions);
        if (recognition !== undefined && expected.has(recognition.api)) {
          const known = callsByNode.get(nodeKey(node));
          const semantic = semanticDeclaration(node);
          return {
            kind: "resolved",
            value:
              known ??
              ({
                api: recognition.api,
                recognition,
                call: node,
                semantic,
                focus: focusForCall(node, semantic),
              } satisfies CallCandidate),
          };
        }
        const returned = resolver.returnedValue(node, resolved.value.substitutions, depth + 1);
        if (returned.kind === "resolved") {
          return publicCall(returned.value, expected, depth + 1, active);
        }
        return returned;
      }
      return { kind: "unresolved", reason: "dynamic", nodes: [node] };
    } finally {
      active.delete(key);
    }
  };

  const bindingSource = (binding: ts.BindingElement): ts.Expression | undefined => {
    let pattern: ts.Node = binding.parent;
    while (ts.isBindingElement(pattern.parent)) pattern = pattern.parent.parent;
    const owner = pattern.parent;
    return ts.isVariableDeclaration(owner) ? owner.initializer : undefined;
  };

  const vocabularyOrigin = (
    input: SourceInput,
    depth = 0,
    active = new Set<string>(),
  ): StaticResolution<VocabularyOrigin> => {
    controller.checkpoint();
    if (depth > controller.limits.maxStaticResolutionDepth) {
      return { kind: "unresolved", reason: "depth", nodes: [inputNode(input)] };
    }
    const key = `${nodeKey(inputNode(input))}:vocabulary`;
    if (active.has(key)) {
      return { kind: "unresolved", reason: "cycle", nodes: [inputNode(input)] };
    }
    active.add(key);
    try {
      const direct = publicCall(input, new Set(["vocabulary", "conceptSet"]), depth + 1);
      if (direct.kind === "resolved") {
        return {
          kind: "resolved",
          value: {
            kind: direct.value.api === "conceptSet" ? "concept-set" : "vocabulary",
            call: direct.value.call,
            resolution: sourceResolution(direct.value.recognition),
          },
        };
      }

      const resolver = resolverFor(input);
      const resolved = resolver.value(input);
      const current = resolved.kind === "resolved" ? resolved.value : input;
      const node = unwrap(inputNode(current));
      if (ts.isShorthandPropertyAssignment(node)) {
        const checker = checkerFor(node);
        controller.checkpoint();
        const symbol = checker.getShorthandAssignmentValueSymbol(node);
        controller.checkpoint();
        for (const declaration of symbol?.declarations ?? []) {
          if (!ts.isBindingElement(declaration)) continue;
          const name = declaration.propertyName ?? declaration.name;
          if (
            (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) &&
            name.text === "vocabulary"
          ) {
            const source = bindingSource(declaration);
            if (source !== undefined) {
              const set = publicCall(source, new Set(["conceptSet"]), depth + 1);
              if (set.kind === "resolved") {
                return {
                  kind: "resolved",
                  value: {
                    kind: "concept-set",
                    call: set.value.call,
                    resolution: "static-flow",
                  },
                };
              }
              return set;
            }
          }
        }
      }
      if (
        (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) &&
        propertyAccessName(node, resolver) === "vocabulary"
      ) {
        const receiver = staticValue(node.expression, inputSubstitutions(current));
        const set = publicCall(receiver, new Set(["conceptSet"]), depth + 1);
        if (set.kind === "resolved") {
          return {
            kind: "resolved",
            value: {
              kind: "concept-set",
              call: set.value.call,
              resolution: "static-flow",
            },
          };
        }
        return set;
      }
      if (ts.isIdentifier(node)) {
        const checker = checkerFor(node);
        controller.checkpoint();
        const original = checker.getSymbolAtLocation(node);
        controller.checkpoint();
        const declarations = [
          ...(original?.declarations ?? []),
          ...(targetSymbol(checker, original, controller)?.declarations ?? []),
        ];
        for (const declaration of declarations) {
          if (ts.isBindingElement(declaration)) {
            const name = declaration.propertyName ?? declaration.name;
            if (
              (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) &&
              name.text === "vocabulary"
            ) {
              const source = bindingSource(declaration);
              if (source !== undefined) {
                const set = publicCall(source, new Set(["conceptSet"]), depth + 1);
                if (set.kind === "resolved") {
                  return {
                    kind: "resolved",
                    value: {
                      kind: "concept-set",
                      call: set.value.call,
                      resolution: "static-flow",
                    },
                  };
                }
              }
            }
          }
        }
      }
      return direct;
    } finally {
      active.delete(key);
    }
  };

  const assemblies = calls.filter(({ api }) => api === "assemble");

  const rootDeclarations = (root: SourceAttributionRoot): ts.Node[] => {
    validSourcePath(root.path, "sourceRoots.path");
    if (
      root.exportName !== undefined &&
      (typeof root.exportName !== "string" || root.exportName === "")
    ) {
      throw new TypeError("sourceRoots.exportName must be a non-empty string");
    }
    if (root.offset !== undefined) nonNegativeInteger(root.offset, "sourceRoots.offset");
    if (root.exportName !== undefined && root.offset !== undefined) {
      throw new TypeError("sourceRoots entries may select an exportName or offset, not both");
    }
    const source = sourceByPath.get(root.path);
    if (source === undefined) return [];
    if (root.exportName !== undefined) {
      const checker = checkerFor(source);
      controller.checkpoint();
      const module = checker.getSymbolAtLocation(source);
      controller.checkpoint();
      const exported =
        module === undefined
          ? undefined
          : checker.getExportsOfModule(module).find(({ name }) => name === root.exportName);
      controller.checkpoint();
      const target = targetSymbol(checker, exported, controller) ?? exported;
      return [...new Set([...(exported?.declarations ?? []), ...(target?.declarations ?? [])])];
    }
    if (root.offset !== undefined) {
      if (root.offset > source.text.length) return [];
      let selected: ts.Node = source;
      const visit = (node: ts.Node): void => {
        if (node.getStart(source) <= root.offset! && root.offset! <= node.getEnd()) {
          selected = node;
          ts.forEachChild(node, visit);
        }
      };
      visit(source);
      return [selected];
    }
    return [source];
  };

  const assemblyCandidates = (): CallCandidate[] => {
    if (options.sourceRoots === undefined) return assemblies;
    const roots = options.sourceRoots.flatMap(rootDeclarations);
    const expanded = new Set<ts.Node>(roots);
    for (const root of roots) {
      const resolved = resolverFor(root).value(root);
      if (resolved.kind === "resolved") expanded.add(resolved.value.node);
    }
    return assemblies.filter(({ call, semantic }) =>
      [...expanded].some(
        (root) => contains(root, call) || contains(root, semantic) || contains(call, root),
      ),
    );
  };

  const selectedAssemblies = [
    ...new Map(
      assemblyCandidates().map((candidate) => [nodeKey(candidate.call), candidate]),
    ).values(),
  ];
  let assembly: CallCandidate | undefined;
  if (selectedAssemblies.length === 1) {
    [assembly] = selectedAssemblies;
  } else if (selectedAssemblies.length === 0) {
    reportFor(
      "UNRESOLVED_ASSEMBLY_SOURCE",
      "No assemble call was resolved from the supplied source roots.",
    );
  } else {
    reportFor(
      "AMBIGUOUS_ASSEMBLY_SOURCE",
      `${selectedAssemblies.length} assemble calls are equally attributable to the supplied source roots.`,
      undefined,
      undefined,
      rangesForNodes(selectedAssemblies.map(({ semantic }) => semantic)),
    );
  }

  let assemblyObject: SourceInput | undefined;
  let vocabularyProperty: StaticProperty | undefined;
  let origin: VocabularyOrigin | undefined;
  if (assembly !== undefined) {
    const [argument] = assembly.call.arguments;
    if (argument !== undefined) {
      assemblyObject = staticValue(argument);
      const property = resolverFor(assemblyObject).property(assemblyObject, "vocabulary");
      if (property.kind === "resolved") {
        vocabularyProperty = property.value;
        const resolution = vocabularyOrigin(property.value.value);
        if (resolution.kind === "resolved") origin = resolution.value;
        else {
          reportFor(
            resolution.kind === "ambiguous"
              ? "AMBIGUOUS_VOCABULARY_SOURCE"
              : "UNRESOLVED_VOCABULARY_SOURCE",
            resolution.kind === "ambiguous"
              ? "The selected assembly has multiple possible vocabulary sources."
              : "The selected assembly vocabulary could not be resolved statically.",
            undefined,
            undefined,
            "nodes" in resolution ? rangesForNodes(resolution.nodes) : undefined,
          );
        }
      } else {
        reportFor(
          property.kind === "ambiguous"
            ? "AMBIGUOUS_VOCABULARY_SOURCE"
            : "UNRESOLVED_VOCABULARY_SOURCE",
          "The selected assembly does not expose one static vocabulary property.",
          undefined,
          undefined,
          "nodes" in property ? rangesForNodes(property.nodes) : undefined,
        );
      }
    }
  }

  const registrationSource = (value: SourceInput): StaticResolution<RegistrationSource> => {
    const selected = publicCall(value, new Set(["registerConcept"]));
    if (selected.kind !== "resolved") return selected;
    const [argument] = selected.value.call.arguments;
    if (argument === undefined) {
      return { kind: "unresolved", reason: "dynamic", nodes: [selected.value.call] };
    }
    return {
      kind: "resolved",
      value: {
        call: selected.value.call,
        candidate: selected.value,
        object: staticValue(argument),
      },
    };
  };

  const conceptSources = new Map<string, ConceptSource>();
  const conceptContainer =
    origin === undefined
      ? undefined
      : origin.kind === "concept-set"
        ? origin.call.arguments[0]
        : (() => {
            const [declaration] = origin.call.arguments;
            if (declaration === undefined) return undefined;
            const concepts = resolverFor(declaration).property(declaration, "concepts");
            return concepts.kind === "resolved" ? concepts.value.value : undefined;
          })();

  for (const implementation of manifest.conceptImplementations) {
    controller.checkpoint();
    if (implementation.canonical.owner === "core") continue;
    const ref: DesignRef = { kind: "concept", concept: implementation.concept };
    if (conceptContainer === undefined) {
      if (origin !== undefined) {
        reportFor(
          origin.kind === "concept-set"
            ? "MISSING_CONCEPT_REGISTRATION"
            : "UNRESOLVED_VOCABULARY_SOURCE",
          `No source declaration was resolved for concept ${implementation.concept}.`,
          ref,
          "declaration",
        );
      }
      continue;
    }
    const declaration = resolverFor(conceptContainer).property(
      conceptContainer,
      implementation.concept,
    );
    if (declaration.kind !== "resolved") {
      const registrationCode =
        declaration.kind === "ambiguous"
          ? "AMBIGUOUS_CONCEPT_REGISTRATION"
          : "MISSING_CONCEPT_REGISTRATION";
      reportFor(
        origin?.kind === "concept-set" ? registrationCode : "UNRESOLVED_DESIGN_SOURCE",
        `Concept ${implementation.concept} has no single static source declaration.`,
        ref,
        "declaration",
        "nodes" in declaration ? rangesForNodes(declaration.nodes) : undefined,
      );
      continue;
    }
    add(
      ref,
      anchorForNode(
        declaration.value.declaration,
        "declaration",
        origin?.resolution ?? "static-flow",
        declaration.value.nameNode,
      ),
    );

    let registration: RegistrationSource | undefined;
    let canonical: SourceInput | undefined;
    if (origin?.kind === "concept-set") {
      const resolvedRegistration = registrationSource(declaration.value.value);
      if (resolvedRegistration.kind !== "resolved") {
        reportFor(
          resolvedRegistration.kind === "ambiguous"
            ? "AMBIGUOUS_CONCEPT_REGISTRATION"
            : "MISSING_CONCEPT_REGISTRATION",
          resolvedRegistration.kind === "ambiguous"
            ? `Concept ${implementation.concept} has multiple possible registrations.`
            : `Concept ${implementation.concept} has no statically resolved registration.`,
          ref,
          "registration",
          "nodes" in resolvedRegistration ? rangesForNodes(resolvedRegistration.nodes) : undefined,
        );
      } else {
        registration = resolvedRegistration.value;
        add(
          ref,
          anchorForNode(
            registration.candidate.semantic,
            "registration",
            sourceResolution(registration.candidate.recognition),
            registration.candidate.focus,
          ),
        );
        const classProperty = resolverFor(registration.object).property(
          registration.object,
          "class",
        );
        if (classProperty.kind === "resolved") canonical = classProperty.value.value;
      }
    } else {
      const classProperty = resolverFor(declaration.value.value).property(
        declaration.value.value,
        "class",
      );
      canonical =
        classProperty.kind === "resolved" ? classProperty.value.value : declaration.value.value;
    }
    conceptSources.set(implementation.concept, {
      declaration: declaration.value,
      ...(registration === undefined ? {} : { registration }),
      ...(canonical === undefined ? {} : { canonical }),
    });
  }

  const implementationValue = (
    input: SourceInput,
    depth = 0,
    active = new Set<string>(),
  ): StaticResolution<StaticValue> => {
    controller.checkpoint();
    if (depth > controller.limits.maxStaticResolutionDepth) {
      return { kind: "unresolved", reason: "depth", nodes: [inputNode(input)] };
    }
    const key = `${nodeKey(inputNode(input))}:implementation`;
    if (active.has(key)) {
      return { kind: "unresolved", reason: "cycle", nodes: [inputNode(input)] };
    }
    active.add(key);
    try {
      const resolver = resolverFor(input);
      const selected = resolver.value(input);
      if (selected.kind !== "resolved") return selected;
      const node = unwrap(selected.value.node);
      if (ts.isNewExpression(node)) {
        return resolver.value(staticValue(node.expression, selected.value.substitutions));
      }
      if (ts.isCallExpression(node)) {
        if (resolver.apiOfCall(node, selected.value.substitutions) !== undefined) {
          return { kind: "unresolved", reason: "dynamic", nodes: [node] };
        }
        const returned = resolver.returnedValue(node, selected.value.substitutions, depth + 1);
        return returned.kind === "resolved"
          ? implementationValue(returned.value, depth + 1, active)
          : returned;
      }
      if (
        ts.isClassDeclaration(node) ||
        ts.isClassExpression(node) ||
        ts.isObjectLiteralExpression(node)
      ) {
        return selected;
      }
      return { kind: "unresolved", reason: "dynamic", nodes: [node] };
    } finally {
      active.delete(key);
    }
  };

  const conceptSetFromImplementations = (
    input: SourceInput,
  ): { call: ts.CallExpression; floor?: string } | undefined => {
    const resolver = resolverFor(input);
    const selected = resolver.value(input);
    if (selected.kind !== "resolved") return undefined;
    const node = unwrap(selected.value.node);
    if (!ts.isCallExpression(node)) return undefined;
    const expression = unwrap(node.expression);
    if (
      (!ts.isPropertyAccessExpression(expression) && !ts.isElementAccessExpression(expression)) ||
      propertyAccessName(expression, resolver) !== "implementations"
    ) {
      return undefined;
    }
    const set = publicCall(
      staticValue(expression.expression, selected.value.substitutions),
      new Set(["conceptSet"]),
    );
    if (set.kind !== "resolved") return undefined;
    const floor =
      node.arguments[0] === undefined
        ? undefined
        : resolver.string(node.arguments[0], selected.value.substitutions);
    return { call: set.value.call, ...(floor === undefined ? {} : { floor }) };
  };

  const floorImplementation = (
    concept: string,
    selected: ApplicationManifestV5["conceptImplementations"][number]["selected"],
    instances: StaticProperty,
  ): StaticResolution<StaticValue> | undefined => {
    if (selected.via !== "instances" || selected.floor === undefined) return undefined;
    const set = conceptSetFromImplementations(instances.value);
    if (set === undefined || set.floor !== selected.floor || set.call.arguments[0] === undefined) {
      return { kind: "unresolved", reason: "dynamic", nodes: [instances.declaration] };
    }
    const registrationProperty = resolverFor(set.call.arguments[0]).property(
      set.call.arguments[0],
      concept,
    );
    if (registrationProperty.kind !== "resolved") return registrationProperty;
    const registration = registrationSource(registrationProperty.value.value);
    if (registration.kind !== "resolved") return registration;
    const floors = resolverFor(registration.value.object).property(
      registration.value.object,
      "floors",
    );
    if (floors.kind !== "resolved") return floors;
    const floor = resolverFor(floors.value.value).property(floors.value.value, selected.floor);
    if (floor.kind !== "resolved") return floor;
    const returned = resolverFor(floor.value.value).returnOfFunction(floor.value.value, [], 0);
    return returned.kind === "resolved" ? implementationValue(returned.value) : returned;
  };

  const memberAnchor = (
    implementation: StaticValue,
    name: string,
    role: "canonical-contract" | "selected-implementation",
  ): SourceAnchor | undefined => {
    const resolver = resolverFor(implementation);
    const classMember = resolver.concreteClassMember(implementation, name);
    if (classMember.kind === "resolved") {
      return anchorForNode(classMember.value, role, "static-flow", namedFocus(classMember.value));
    }
    const property = resolver.property(implementation, name);
    return property.kind === "resolved"
      ? anchorForNode(property.value.declaration, role, "static-flow", property.value.nameNode)
      : undefined;
  };

  for (const implementation of manifest.conceptImplementations) {
    controller.checkpoint();
    if (implementation.canonical.owner === "core") continue;
    const source = conceptSources.get(implementation.concept);
    const conceptRef: DesignRef = { kind: "concept", concept: implementation.concept };
    const concept = manifest.concepts.find(({ name }) => name === implementation.concept)!;
    let canonical: StaticValue | undefined;
    if (source?.canonical !== undefined) {
      const resolved = implementationValue(source.canonical);
      if (resolved.kind === "resolved") canonical = resolved.value;
    }
    if (canonical === undefined) {
      reportFor(
        "UNRESOLVED_DESIGN_SOURCE",
        `The canonical implementation for concept ${implementation.concept} was not resolved.`,
        conceptRef,
        "canonical-contract",
      );
    } else {
      add(
        conceptRef,
        anchorForNode(
          canonical.node,
          "canonical-contract",
          "static-flow",
          namedFocus(canonical.node),
        ),
      );
      for (const action of concept.actions) {
        const ref: DesignRef = {
          kind: "action",
          concept: implementation.concept,
          action: action.name,
        };
        const anchor = memberAnchor(canonical, action.name, "canonical-contract");
        add(ref, anchor);
        if (anchor === undefined) {
          reportFor(
            "UNRESOLVED_DESIGN_SOURCE",
            `The canonical member ${implementation.concept}.${action.name} was not resolved.`,
            ref,
            "canonical-contract",
          );
        }
      }
      for (const query of concept.queries) {
        const ref: DesignRef = {
          kind: "query",
          concept: implementation.concept,
          query: query.name,
        };
        const anchor = memberAnchor(canonical, query.name, "canonical-contract");
        add(ref, anchor);
        if (anchor === undefined) {
          reportFor(
            "UNRESOLVED_DESIGN_SOURCE",
            `The canonical member ${implementation.concept}.${query.name} was not resolved.`,
            ref,
            "canonical-contract",
          );
        }
      }
    }

    let selectionNode = vocabularyProperty?.declaration;
    let selectedValue: StaticResolution<StaticValue> | undefined;
    if (implementation.selected.via === "default" || implementation.selected.via === "initialize") {
      selectedValue =
        canonical === undefined
          ? {
              kind: "unresolved",
              reason: "dynamic",
              nodes: source === undefined ? [] : [source.declaration.declaration],
            }
          : { kind: "resolved", value: canonical };
      if (implementation.selected.via === "initialize" && assemblyObject !== undefined) {
        const initialize = resolverFor(assemblyObject).property(assemblyObject, "initialize");
        if (initialize.kind === "resolved") {
          const selected = resolverFor(initialize.value.value).property(
            initialize.value.value,
            implementation.concept,
          );
          selectionNode =
            selected.kind === "resolved"
              ? selected.value.declaration
              : initialize.value.declaration;
        }
      }
    } else if (implementation.selected.via === "instances" && assemblyObject !== undefined) {
      const instances = resolverFor(assemblyObject).property(assemblyObject, "instances");
      if (instances.kind === "resolved") {
        selectionNode = instances.value.declaration;
        selectedValue = floorImplementation(
          implementation.concept,
          implementation.selected,
          instances.value,
        );
        if (selectedValue === undefined) {
          const selected = resolverFor(instances.value.value).property(
            instances.value.value,
            implementation.concept,
          );
          if (selected.kind === "resolved") {
            selectionNode = selected.value.declaration;
            selectedValue = implementationValue(selected.value.value);
          } else {
            selectedValue = selected;
          }
        }
      }
    }
    if (selectionNode !== undefined) {
      add(
        conceptRef,
        anchorForNode(selectionNode, "selection", "manifest-provenance", namedFocus(selectionNode)),
      );
    }
    if (selectedValue?.kind !== "resolved") {
      reportFor(
        "UNRESOLVED_IMPLEMENTATION_SELECTION",
        `The implementation selected for concept ${implementation.concept} was not resolved statically.`,
        conceptRef,
        "selected-implementation",
        selectedValue !== undefined && "nodes" in selectedValue
          ? rangesForNodes(selectedValue.nodes)
          : undefined,
      );
      continue;
    }
    const selectedImplementation = selectedValue.value;
    add(
      conceptRef,
      anchorForNode(
        selectedImplementation.node,
        "selected-implementation",
        "static-flow",
        namedFocus(selectedImplementation.node),
      ),
    );
    for (const action of concept.actions) {
      add(
        { kind: "action", concept: implementation.concept, action: action.name },
        memberAnchor(selectedImplementation, action.name, "selected-implementation"),
      );
    }
    for (const query of concept.queries) {
      add(
        { kind: "query", concept: implementation.concept, query: query.name },
        memberAnchor(selectedImplementation, query.name, "selected-implementation"),
      );
    }
  }

  const importedPath = (input: SourceInput): string | undefined => {
    const pathFromDeclarations = (
      declarations: readonly ts.Declaration[],
      active: Set<string>,
      visit: (node: ts.Node, active: Set<string>) => string | undefined,
    ): string | undefined => {
      for (const declaration of declarations) {
        let importDeclaration: ts.ImportDeclaration | undefined;
        if (ts.isImportClause(declaration) && ts.isImportDeclaration(declaration.parent)) {
          importDeclaration = declaration.parent;
        } else if (
          (ts.isImportSpecifier(declaration) || ts.isNamespaceImport(declaration)) &&
          ts.isImportDeclaration(declaration.parent.parent.parent)
        ) {
          importDeclaration = declaration.parent.parent.parent;
        }
        if (
          importDeclaration !== undefined &&
          ts.isStringLiteralLike(importDeclaration.moduleSpecifier) &&
          importDeclaration.moduleSpecifier.text.startsWith(".")
        ) {
          return resolve(
            dirname(importDeclaration.getSourceFile().fileName),
            importDeclaration.moduleSpecifier.text,
          );
        }
        if (ts.isVariableDeclaration(declaration) && declaration.initializer !== undefined) {
          const path = visit(declaration.initializer, active);
          if (path !== undefined) return path;
        }
      }
      return undefined;
    };
    const visit = (node: ts.Node, active = new Set<string>()): string | undefined => {
      node = unwrap(node);
      const key = nodeKey(node);
      if (active.has(key)) return undefined;
      active.add(key);
      try {
        if (ts.isShorthandPropertyAssignment(node)) {
          const checker = checkerFor(node);
          controller.checkpoint();
          const symbol = checker.getShorthandAssignmentValueSymbol(node);
          controller.checkpoint();
          return pathFromDeclarations(symbol?.declarations ?? [], active, visit);
        }
        if (ts.isPropertyAssignment(node)) return visit(node.initializer, active);
        if (!ts.isIdentifier(node)) return undefined;
        const checker = checkerFor(node);
        controller.checkpoint();
        const symbol = checker.getSymbolAtLocation(node);
        controller.checkpoint();
        const declarations = [
          ...(symbol?.declarations ?? []),
          ...(targetSymbol(checker, symbol, controller)?.declarations ?? []),
        ];
        return pathFromDeclarations(declarations, active, visit);
      } finally {
        active.delete(key);
      }
    };
    return visit(inputNode(input));
  };

  const specificationBlock = (
    path: string,
    text: string,
    line: number,
    column: number,
    name: string,
  ): SourceAnchor => {
    const starts = [0];
    for (let offset = text.indexOf("\n"); offset >= 0; offset = text.indexOf("\n", offset + 1)) {
      starts.push(offset + 1);
    }
    const sourceLine = Math.max(0, Math.min(starts.length - 1, line - 1));
    const content = (at: number): string => {
      const start = starts[at];
      const newline = text.indexOf("\n", start);
      const end = newline < 0 ? text.length : newline;
      return text.slice(start, end).replace(/\r$/, "");
    };
    let first = sourceLine;
    for (let current = sourceLine; current >= 0; current -= 1) {
      if (/^```(?:actions|queries)\s*$/.test(content(current))) {
        first = current;
        break;
      }
    }
    let last = sourceLine;
    for (let current = sourceLine + 1; current < starts.length; current += 1) {
      if (/^```\s*$/.test(content(current))) {
        last = current;
        break;
      }
    }
    const start = starts[first];
    const end = starts[last] + content(last).length;
    const declared = starts[sourceLine] + Math.max(0, column - 1);
    const found = text.indexOf(name, declared);
    const focusStart = found >= declared && found < end ? found : declared;
    const range = rangeForText(path, text, start, end);
    const slice = text.slice(start, end);
    return {
      role: "specification",
      range,
      digest: sha256(slice),
      resolution: "manifest-location",
      focusRange: rangeForText(path, text, focusStart, Math.min(end, focusStart + name.length)),
    };
  };

  for (const concept of manifest.concepts) {
    controller.checkpoint();
    const source = conceptSources.get(concept.name);
    const specProperty =
      source?.registration === undefined
        ? undefined
        : resolverFor(source.registration.object).property(source.registration.object, "spec");
    if (specProperty?.kind !== "resolved") continue;
    const absolute = importedPath(specProperty.value.value);
    const ref: DesignRef = { kind: "concept", concept: concept.name };
    if (absolute === undefined) {
      if (resolverFor(specProperty.value.value).string(specProperty.value.value) !== undefined) {
        continue;
      }
      reportFor(
        "SPECIFICATION_UNREADABLE",
        `The specification for ${concept.name} is not a statically resolved project file.`,
        ref,
        "specification",
      );
      continue;
    }
    const path = canonicalSourcePath(projectRoot, absolute);
    if (path === undefined) {
      reportFor(
        "SOURCE_OUTSIDE_PROJECT",
        `The specification for ${concept.name} is outside the supplied project root.`,
        ref,
        "specification",
      );
      continue;
    }
    let text: string | undefined;
    try {
      text = readFile(absolute);
    } catch {
      text = undefined;
    }
    if (text === undefined) {
      reportFor(
        "SPECIFICATION_UNREADABLE",
        `The specification for ${concept.name} could not be read at ${path}.`,
        ref,
        "specification",
      );
      continue;
    }
    addDocument(path, text);
    const wholeRange = rangeForText(path, text, 0, text.length);
    add(ref, {
      role: "specification",
      range: wholeRange,
      digest: sha256(text),
      resolution: "manifest-location",
    });
    try {
      const parsed = parseConceptSpecification(text.replaceAll("\r\n", "\n"));
      if (!sameSpecification(concept.specification, parsed)) {
        reportFor(
          "SPECIFICATION_MISMATCH",
          `The current specification for ${concept.name} differs from the supplied manifest.`,
          ref,
          "specification",
        );
      }
      for (const action of parsed.actions) {
        add(
          { kind: "action", concept: concept.name, action: action.name },
          specificationBlock(path, text, action.location.line, action.location.column, action.name),
        );
      }
      for (const query of parsed.queries) {
        add(
          { kind: "query", concept: concept.name, query: query.name },
          specificationBlock(path, text, query.location.line, query.location.column, query.name),
        );
      }
    } catch (error) {
      reportFor(
        "SPECIFICATION_MISMATCH",
        `The current specification for ${concept.name} cannot be parsed (${error instanceof Error ? error.message : String(error)}).`,
        ref,
        "specification",
      );
    }
  }

  const composition = new Map<string, CompositionCandidate[]>();
  const compositionAmbiguities = new Map<string, ts.Node[]>();
  const walkComposition = (
    input: SourceInput,
    prefix = "",
    depth = 0,
    active = new Set<string>(),
  ): void => {
    controller.checkpoint();
    if (depth > controller.limits.maxStaticResolutionDepth) return;
    const key = `${nodeKey(inputNode(input))}:${prefix}`;
    if (active.has(key)) return;
    active.add(key);
    try {
      const object = resolverFor(input).object(input, depth + 1);
      if (object.kind !== "resolved") return;
      for (const [name, property] of [...object.value.entries].sort(([left], [right]) =>
        ordinal(left, right),
      )) {
        controller.checkpoint();
        const qualified = prefix === "" ? name : `${prefix}.${name}`;
        if (property.kind !== "resolved") {
          if ("nodes" in property) compositionAmbiguities.set(qualified, [...property.nodes]);
          continue;
        }
        const declaration = publicCall(property.value.value, DECLARATION_APIS);
        if (declaration.kind === "resolved") {
          const values = composition.get(qualified) ?? [];
          values.push({ name: qualified, candidate: declaration.value });
          composition.set(qualified, values);
          continue;
        }
        walkComposition(property.value.value, qualified, depth + 1, active);
      }
    } finally {
      active.delete(key);
    }
  };

  if (assemblyObject !== undefined) {
    const property = resolverFor(assemblyObject).property(assemblyObject, "composition");
    if (property.kind === "resolved") walkComposition(property.value.value);
  }

  const declarationAnchor = (
    candidate: CallCandidate,
    resolution: SourceResolution = sourceResolution(candidate.recognition),
  ): SourceAnchor | undefined =>
    anchorForNode(candidate.semantic, "declaration", resolution, candidate.focus);

  const candidateLiteral = (candidate: CallCandidate): string | undefined => {
    const [first] = candidate.call.arguments;
    return first === undefined ? undefined : resolverFor(first).string(first);
  };

  const chooseCandidate = (
    ref: DesignRef,
    selected: readonly CompositionCandidate[],
    ambiguityCode: SourceIndexIssueCode = "AMBIGUOUS_DESIGN_SOURCE",
  ): CallCandidate | undefined => {
    const unique = [
      ...new Map(selected.map(({ candidate }) => [nodeKey(candidate.call), candidate])).values(),
    ];
    if (unique.length === 1) return unique[0];
    if (unique.length > 1) {
      reportFor(
        ambiguityCode,
        `${designRefKey(ref)} has ${unique.length} equally plausible source declarations.`,
        ref,
        "declaration",
        rangesForNodes(unique.map(({ semantic }) => semantic)),
      );
    } else {
      const ambiguous = compositionAmbiguities.get(
        ref.kind === "reaction"
          ? reactionFamilyBase(ref.reaction)
          : ref.kind === "endpoint"
            ? ref.endpoint
            : "",
      );
      reportFor(
        ambiguous === undefined ? "UNRESOLVED_DESIGN_SOURCE" : ambiguityCode,
        `No single source declaration was resolved for ${designRefKey(ref)}.`,
        ref,
        "declaration",
        ambiguous === undefined ? undefined : rangesForNodes(ambiguous),
      );
    }
    return undefined;
  };

  if (assembly !== undefined) {
    for (const reaction of [...manifest.application.reactions, ...manifest.application.unlowered]) {
      const ref: DesignRef = { kind: "reaction", reaction: reaction.name };
      const exact = composition.get(reaction.name) ?? [];
      const family =
        exact.length === 0 ? (composition.get(reactionFamilyBase(reaction.name)) ?? []) : exact;
      const selected = family.filter(
        ({ candidate }) => candidate.api === "reaction" || candidate.api === "endpoint",
      );
      const candidate = chooseCandidate(ref, selected);
      if (candidate !== undefined) {
        add(
          ref,
          declarationAnchor(
            candidate,
            candidate.api === "endpoint"
              ? "manifest-location"
              : sourceResolution(candidate.recognition),
          ),
        );
      }
    }

    for (const view of manifest.application.views) {
      const ref: DesignRef = { kind: "view", view: view.name };
      const selected = [...composition.values()]
        .flat()
        .filter(
          ({ candidate }) => candidate.api === "view" && candidateLiteral(candidate) === view.name,
        );
      const candidate = chooseCandidate(ref, selected);
      if (candidate !== undefined) add(ref, declarationAnchor(candidate));
    }

    for (const former of manifest.application.formers) {
      const ref: DesignRef = { kind: "former", former: former.name };
      const selected = [...composition.values()]
        .flat()
        .filter(
          ({ candidate }) =>
            candidate.api === "former" && candidateLiteral(candidate) === former.name,
        );
      const candidate = chooseCandidate(ref, selected);
      if (candidate !== undefined) add(ref, declarationAnchor(candidate));
    }

    for (const endpoint of manifest.endpoints) {
      const ref: DesignRef = { kind: "endpoint", endpoint: endpoint.name, path: endpoint.path };
      const selected = (composition.get(endpoint.name) ?? []).filter(
        ({ candidate }) =>
          candidate.api === "endpoint" && candidateLiteral(candidate) === endpoint.path,
      );
      const candidate = chooseCandidate(ref, selected, "AMBIGUOUS_ENDPOINT_SOURCE");
      if (candidate !== undefined) add(ref, declarationAnchor(candidate));
    }
  }

  if (origin !== undefined) {
    const computationContainer =
      origin.kind === "concept-set"
        ? origin.call.arguments[1]
        : (() => {
            const declaration = origin.call.arguments[0];
            if (declaration === undefined) return undefined;
            const property = resolverFor(declaration).property(declaration, "computations");
            return property.kind === "resolved" ? property.value.value : undefined;
          })();
    for (const computation of manifest.computations) {
      controller.checkpoint();
      if (computation.source === "standard") continue;
      const ref: DesignRef = { kind: "computation", computation: computation.name };
      if (computationContainer === undefined) {
        reportFor(
          "UNRESOLVED_COMPUTATION_SOURCE",
          `No vocabulary computation source was resolved for ${computation.name}.`,
          ref,
          "declaration",
        );
        continue;
      }
      const property = resolverFor(computationContainer).property(
        computationContainer,
        computation.name,
      );
      if (property.kind !== "resolved") {
        reportFor(
          "UNRESOLVED_COMPUTATION_SOURCE",
          `Vocabulary computation ${computation.name} has no single static source declaration.`,
          ref,
          "declaration",
          "nodes" in property ? rangesForNodes(property.nodes) : undefined,
        );
        continue;
      }
      add(
        ref,
        anchorForNode(
          property.value.declaration,
          "declaration",
          origin.resolution,
          property.value.nameNode,
        ),
      );
      const selected = resolverFor(property.value.value).value(property.value.value);
      const node = selected.kind === "resolved" ? selected.value.node : property.value.declaration;
      add(ref, anchorForNode(node, "selected-implementation", "static-flow", namedFocus(node)));
    }
  }

  const resultEntries = [...entries.values()]
    .map(({ ref, sources }) => ({
      ref,
      sources: [...sources.values()].sort((left, right) =>
        ordinal(anchorKey(left), anchorKey(right)),
      ),
    }))
    .sort((left, right) => ordinal(designRefKey(left.ref), designRefKey(right.ref)));
  const retainedUsage = usageDelta(before, controller.usage());

  return freezeAnalysisData({
    format: "sync-engine.application-source-index",
    version: 2,
    provenance: analysisProvenance(manifest),
    manifestDigest: manifest.digest,
    typescriptVersion: ts.version,
    documents: [...documents.values()].sort((left, right) => ordinal(left.path, right.path)),
    entries: resultEntries,
    issues: [...issues.values()].sort((left, right) => ordinal(issueKey(left), issueKey(right))),
    resourceUsage: { ...retainedUsage, projectFiles: 0, projectBytes: 0 },
  });
}
