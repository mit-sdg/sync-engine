import { createHash } from "node:crypto";
import { isAbsolute, relative, resolve, sep } from "node:path";
import {
  parseConceptSpecification,
  type ApplicationManifestV4,
  type ConceptSpecificationIR,
  type ReactionIR,
  type UnloweredIR,
} from "@mit-sdg/sync-engine/tooling";
import ts from "typescript";
import { designRefKey, type DesignRef } from "./application-impact.ts";

export interface SourcePosition {
  /** UTF-16 offset, matching the TypeScript compiler API. */
  readonly offset: number;
  /** One-based line. */
  readonly line: number;
  /** One-based column. */
  readonly column: number;
}

export interface SourceRange {
  /** POSIX path relative to the supplied project root. */
  readonly path: string;
  /** Half-open range start. */
  readonly start: SourcePosition;
  /** Half-open range end. */
  readonly end: SourcePosition;
}

export type SourceRole = "declaration" | "implementation" | "registration" | "specification";
export type SourceResolution = "literal-name" | "name-and-footprint" | "manifest-location";

/** One exact source slice associated with a logical design reference. */
export interface SourceAnchor {
  readonly role: SourceRole;
  readonly range: SourceRange;
  readonly text: string;
  readonly digest: string;
  readonly resolution: SourceResolution;
}

export interface SourceIndexEntry {
  readonly ref: DesignRef;
  readonly sources: readonly SourceAnchor[];
}

export type SourceIndexIssueCode =
  | "AMBIGUOUS_DESIGN_SOURCE"
  | "UNRESOLVED_DESIGN_SOURCE"
  | "SOURCE_OUTSIDE_PROJECT"
  | "SPECIFICATION_MISMATCH";

export interface SourceIndexIssue {
  readonly code: SourceIndexIssueCode;
  readonly message: string;
  readonly ref?: DesignRef;
  readonly candidates?: readonly SourceRange[];
}

/** Checkout-specific source attribution over one portable application manifest. */
export interface ApplicationSourceIndex {
  readonly format: "sync-engine.application-source-index";
  readonly version: 1;
  readonly manifestDigest: string;
  readonly typescriptVersion: string;
  readonly entries: readonly SourceIndexEntry[];
  readonly issues: readonly SourceIndexIssue[];
}

interface ImportedApis {
  direct: Map<string, string>;
  namespaces: Set<string>;
}

type DeclarationKind = "reaction" | "endpoint" | "view" | "former";

interface DeclarationCandidate {
  kind: DeclarationKind;
  variable?: string;
  literal?: string;
  source: ts.SourceFile;
  node: ts.Node;
  footprint: Set<string>;
}

interface RegistrationCandidate {
  className: string;
  source: ts.SourceFile;
  node: ts.Node;
  specPath?: string;
}

const CORE_MODULES = new Set([
  "@mit-sdg/sync-engine/assembly",
  "@mit-sdg/sync-engine/boundary",
  "@mit-sdg/sync-engine/language",
]);
const DECLARATION_APIS = new Set<DeclarationKind>(["reaction", "endpoint", "view", "former"]);

function ordinal(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function portablePath(path: string): string {
  return path.split(sep).join("/");
}

function digest(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function issueKey(issue: SourceIndexIssue): string {
  return JSON.stringify([
    issue.code,
    issue.ref === undefined ? "" : designRefKey(issue.ref),
    issue.message,
  ]);
}

function anchorKey(anchor: SourceAnchor): string {
  return JSON.stringify([
    anchor.role,
    anchor.range.path,
    anchor.range.start.offset,
    anchor.range.end.offset,
    anchor.resolution,
  ]);
}

function position(source: ts.SourceFile, offset: number): SourcePosition {
  const line = source.getLineAndCharacterOfPosition(offset);
  return { offset, line: line.line + 1, column: line.character + 1 };
}

function sourcePath(projectRoot: string, fileName: string): string | undefined {
  const path = relative(projectRoot, resolve(fileName));
  if (path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path))) {
    return portablePath(path || ".");
  }
  return undefined;
}

function rangeForNode(
  projectRoot: string,
  source: ts.SourceFile,
  node: ts.Node,
): SourceRange | undefined {
  const path = sourcePath(projectRoot, source.fileName);
  if (path === undefined) return undefined;
  const start = node.getStart(source);
  const end = node.getEnd();
  return { path, start: position(source, start), end: position(source, end) };
}

function anchorForNode(
  projectRoot: string,
  source: ts.SourceFile,
  node: ts.Node,
  role: SourceRole,
  resolution: SourceResolution,
): SourceAnchor | undefined {
  const range = rangeForNode(projectRoot, source, node);
  if (range === undefined) return undefined;
  const text = source.text.slice(range.start.offset, range.end.offset);
  return { role, range, text, digest: digest(text), resolution };
}

function offsetAt(text: string, line: number, column: number): number {
  let offset = 0;
  for (let current = 1; current < line; current += 1) {
    const newline = text.indexOf("\n", offset);
    if (newline < 0) return text.length;
    offset = newline + 1;
  }
  return Math.min(text.length, offset + Math.max(0, column - 1));
}

function positionInText(text: string, offset: number): SourcePosition {
  const before = text.slice(0, offset);
  const lines = before.split("\n");
  return { offset, line: lines.length, column: (lines.at(-1)?.length ?? 0) + 1 };
}

function anchorForSpecificationLine(
  path: string,
  text: string,
  line: number,
  column: number,
): SourceAnchor {
  const start = offsetAt(text, line, column);
  const newline = text.indexOf("\n", start);
  const end = newline < 0 ? text.length : newline;
  const slice = text.slice(start, end);
  return {
    role: "specification",
    range: { path, start: positionInText(text, start), end: positionInText(text, end) },
    text: slice,
    digest: digest(slice),
    resolution: "manifest-location",
  };
}

function anchorForSpecification(path: string, text: string): SourceAnchor {
  return {
    role: "specification",
    range: {
      path,
      start: { offset: 0, line: 1, column: 1 },
      end: positionInText(text, text.length),
    },
    text,
    digest: digest(text),
    resolution: "manifest-location",
  };
}

function importedApis(source: ts.SourceFile): ImportedApis {
  const direct = new Map<string, string>();
  const namespaces = new Set<string>();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }
    if (!CORE_MODULES.has(statement.moduleSpecifier.text)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings === undefined) continue;
    if (ts.isNamespaceImport(bindings)) {
      namespaces.add(bindings.name.text);
      continue;
    }
    for (const element of bindings.elements) {
      direct.set(element.name.text, element.propertyName?.text ?? element.name.text);
    }
  }
  return { direct, namespaces };
}

function calledApi(call: ts.CallExpression, apis: ImportedApis): string | undefined {
  if (ts.isIdentifier(call.expression)) return apis.direct.get(call.expression.text);
  if (
    ts.isPropertyAccessExpression(call.expression) &&
    ts.isIdentifier(call.expression.expression) &&
    apis.namespaces.has(call.expression.expression.text)
  ) {
    return call.expression.name.text;
  }
  return undefined;
}

function enclosingVariable(node: ts.Node): ts.VariableDeclaration | undefined {
  let current: ts.Node | undefined = node;
  while (current !== undefined) {
    if (ts.isVariableDeclaration(current)) return current;
    if (ts.isSourceFile(current) || ts.isFunctionLike(current)) return undefined;
    current = current.parent;
  }
  return undefined;
}

function enclosingFunction(node: ts.Node): ts.FunctionLikeDeclaration | undefined {
  let current = node.parent;
  while (current !== undefined && !ts.isSourceFile(current)) {
    if (ts.isFunctionDeclaration(current) || ts.isMethodDeclaration(current)) return current;
    current = current.parent;
  }
  return undefined;
}

function declarationAnchor(call: ts.CallExpression): ts.Node {
  const factory = enclosingFunction(call);
  if (factory !== undefined) return factory;
  const variable = enclosingVariable(call);
  if (variable?.parent?.parent !== undefined && ts.isVariableStatement(variable.parent.parent)) {
    return variable.parent.parent;
  }
  return variable ?? call;
}

function literalArgument(call: ts.CallExpression): string | undefined {
  const [first] = call.arguments;
  return first !== undefined && ts.isStringLiteralLike(first) ? first.text : undefined;
}

function footprintOf(node: ts.Node): Set<string> {
  const footprint = new Set<string>();
  const visit = (child: ts.Node): void => {
    if (
      ts.isPropertyAccessExpression(child) &&
      ts.isIdentifier(child.expression) &&
      ts.isIdentifier(child.name)
    ) {
      footprint.add(`${child.expression.text}.${child.name.text}`);
    }
    ts.forEachChild(child, visit);
  };
  visit(node);
  return footprint;
}

function reactionFootprint(reaction: ReactionIR | UnloweredIR): Set<string> {
  const footprint = new Set<string>();
  const body = "known" in reaction ? reaction.known : reaction;
  for (const trigger of body.when) {
    if (trigger.kind === "action") footprint.add(`${trigger.concept}.${trigger.action}`);
  }
  for (const operation of body.where) {
    if ("query" in operation && operation.query !== undefined) {
      footprint.add(`${operation.query.concept}.${operation.query.query}`);
    }
  }
  for (const consequence of body.then) {
    footprint.add(`${consequence.concept}.${consequence.action}`);
  }
  return footprint;
}

function overlap(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
  let count = 0;
  for (const value of left) if (right.has(value)) count += 1;
  return count;
}

function reactionBase(name: string): string {
  const leaf = name.split(".").at(-1) ?? name;
  return leaf.split(/[#:]/, 1)[0] ?? leaf;
}

function endpointOwnsReaction(
  endpoint: ApplicationManifestV4["endpoints"][number],
  name: string,
): boolean {
  return [endpoint.name, ...endpoint.reactions].some(
    (base) => name === base || name.startsWith(`${base}#`) || name.startsWith(`${base}:`),
  );
}

function propertyName(property: ts.ObjectLiteralElementLike): string | undefined {
  if (
    (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) &&
    (ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name))
  ) {
    return property.name.text;
  }
  return undefined;
}

function registrationOf(
  call: ts.CallExpression,
  source: ts.SourceFile,
): RegistrationCandidate | undefined {
  const [argument] = call.arguments;
  if (!ts.isObjectLiteralExpression(argument)) return undefined;
  let className: string | undefined;
  let specBinding: string | undefined;
  for (const property of argument.properties) {
    const name = propertyName(property);
    if (
      name === "class" &&
      ts.isPropertyAssignment(property) &&
      ts.isIdentifier(property.initializer)
    ) {
      className = property.initializer.text;
    }
    if (name === "spec") {
      if (ts.isPropertyAssignment(property) && ts.isIdentifier(property.initializer)) {
        specBinding = property.initializer.text;
      } else if (ts.isShorthandPropertyAssignment(property)) {
        specBinding = property.name.text;
      }
    }
  }
  if (className === undefined) return undefined;
  let specPath: string | undefined;
  if (specBinding !== undefined) {
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
        continue;
      }
      if (statement.importClause?.name?.text !== specBinding) continue;
      specPath = resolve(source.fileName, "..", statement.moduleSpecifier.text);
    }
  }
  return { className, source, node: declarationAnchor(call), specPath };
}

function sameSpecification(
  left: ConceptSpecificationIR | undefined,
  right: ConceptSpecificationIR,
): boolean {
  return left === undefined || JSON.stringify(left) === JSON.stringify(right);
}

/** Attribute one manifest's logical design references to bounded source slices. */
export function indexApplicationSources(options: {
  readonly manifest: ApplicationManifestV4;
  readonly program: ts.Program;
  readonly projectRoot: string;
  readonly readFile?: (absolutePath: string) => string | undefined;
}): ApplicationSourceIndex {
  const { manifest, program } = options;
  if (manifest.format !== "sync-engine.application-manifest" || manifest.version !== 4) {
    throw new Error("source indexing requires a sync-engine application manifest at version 4");
  }
  const projectRoot = resolve(options.projectRoot);
  const readFile = options.readFile ?? ts.sys.readFile;
  const sourceFiles = program
    .getSourceFiles()
    .filter(
      (source) =>
        !source.isDeclarationFile && sourcePath(projectRoot, source.fileName) !== undefined,
    )
    .sort((left, right) =>
      ordinal(
        sourcePath(projectRoot, left.fileName) ?? "",
        sourcePath(projectRoot, right.fileName) ?? "",
      ),
    );
  const entries = new Map<string, { ref: DesignRef; sources: Map<string, SourceAnchor> }>();
  const issues = new Map<string, SourceIndexIssue>();
  const declarations: DeclarationCandidate[] = [];
  const registrations: RegistrationCandidate[] = [];
  const classes = new Map<string, Array<{ source: ts.SourceFile; node: ts.ClassDeclaration }>>();

  const report = (issue: SourceIndexIssue): void => {
    issues.set(issueKey(issue), issue);
  };
  const add = (ref: DesignRef, anchor: SourceAnchor | undefined): void => {
    if (anchor === undefined) return;
    const key = designRefKey(ref);
    const entry = entries.get(key) ?? { ref, sources: new Map<string, SourceAnchor>() };
    entry.sources.set(anchorKey(anchor), anchor);
    entries.set(key, entry);
  };
  const unresolved = (ref: DesignRef, what: string): void => {
    report({
      code: "UNRESOLVED_DESIGN_SOURCE",
      ref,
      message: `No source was resolved for ${what}.`,
    });
  };

  for (const source of sourceFiles) {
    const apis = importedApis(source);
    const visit = (node: ts.Node): void => {
      if (ts.isClassDeclaration(node) && node.name !== undefined) {
        const candidates = classes.get(node.name.text) ?? [];
        candidates.push({ source, node });
        classes.set(node.name.text, candidates);
      }
      if (ts.isCallExpression(node)) {
        const api = calledApi(node, apis);
        if (api !== undefined && DECLARATION_APIS.has(api as DeclarationKind)) {
          const variable = enclosingVariable(node);
          const literal = literalArgument(node);
          declarations.push({
            kind: api as DeclarationKind,
            ...(variable !== undefined && ts.isIdentifier(variable.name)
              ? { variable: variable.name.text }
              : {}),
            ...(literal === undefined ? {} : { literal }),
            source,
            node: declarationAnchor(node),
            footprint: footprintOf(node),
          });
        }
        if (api === "registerConcept") {
          const registration = registrationOf(node, source);
          if (registration !== undefined) registrations.push(registration);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }

  const sourceAnchor = (
    candidate: DeclarationCandidate,
    resolution: SourceResolution,
  ): SourceAnchor | undefined =>
    anchorForNode(projectRoot, candidate.source, candidate.node, "declaration", resolution);

  const chooseDeclaration = (
    ref: DesignRef,
    candidates: readonly DeclarationCandidate[],
    what: string,
    footprint?: ReadonlySet<string>,
  ): DeclarationCandidate | undefined => {
    if (candidates.length === 1) return candidates[0];
    if (candidates.length === 0) {
      unresolved(ref, what);
      return undefined;
    }
    if (footprint !== undefined) {
      const scored = candidates.map((candidate) => ({
        candidate,
        score: overlap(candidate.footprint, footprint),
      }));
      const maximum = Math.max(...scored.map(({ score }) => score));
      const best = scored.filter(({ score }) => score === maximum && score > 0);
      if (best.length === 1) return best[0].candidate;
    }
    const ranges = candidates.flatMap((candidate) => {
      const range = rangeForNode(projectRoot, candidate.source, candidate.node);
      return range === undefined ? [] : [range];
    });
    report({
      code: "AMBIGUOUS_DESIGN_SOURCE",
      ref,
      candidates: ranges,
      message: `${what} has ${candidates.length} equally plausible source declarations.`,
    });
    return undefined;
  };

  for (const concept of manifest.concepts) {
    const ref: DesignRef = { kind: "concept", concept: concept.name };
    const classCandidates = [
      ...(classes.get(`${concept.name}Concept`) ?? []),
      ...(classes.get(concept.name) ?? []),
    ];
    if (classCandidates.length !== 1) {
      if (classCandidates.length === 0) unresolved(ref, `concept ${concept.name}`);
      else {
        report({
          code: "AMBIGUOUS_DESIGN_SOURCE",
          ref,
          message: `Concept ${concept.name} has ${classCandidates.length} convention-matching classes.`,
          candidates: classCandidates.flatMap(({ source, node }) => {
            const range = rangeForNode(projectRoot, source, node);
            return range === undefined ? [] : [range];
          }),
        });
      }
      continue;
    }
    const [{ source, node: declaration }] = classCandidates;
    add(ref, anchorForNode(projectRoot, source, declaration, "implementation", "literal-name"));
    for (const member of [...concept.actions, ...concept.queries]) {
      const memberRef: DesignRef = member.name.startsWith("_")
        ? { kind: "query", concept: concept.name, query: member.name }
        : { kind: "action", concept: concept.name, action: member.name };
      const methods = declaration.members.filter(
        (candidate): candidate is ts.MethodDeclaration =>
          ts.isMethodDeclaration(candidate) &&
          ts.isIdentifier(candidate.name) &&
          candidate.name.text === member.name,
      );
      if (methods.length === 1) {
        add(
          memberRef,
          anchorForNode(projectRoot, source, methods[0], "implementation", "literal-name"),
        );
      } else {
        unresolved(memberRef, `${concept.name}.${member.name}`);
      }
    }

    const matchingRegistrations = registrations.filter(
      (registration) => registration.className === declaration.name?.text,
    );
    if (matchingRegistrations.length === 1) {
      const [registration] = matchingRegistrations;
      add(
        ref,
        anchorForNode(
          projectRoot,
          registration.source,
          registration.node,
          "registration",
          "literal-name",
        ),
      );
      if (registration.specPath !== undefined) {
        const relativeSpec = sourcePath(projectRoot, registration.specPath);
        const specificationText = readFile(registration.specPath);
        if (relativeSpec === undefined) {
          report({
            code: "SOURCE_OUTSIDE_PROJECT",
            ref,
            message: `The specification for ${concept.name} is outside the supplied project root.`,
          });
        } else if (specificationText !== undefined) {
          add(ref, anchorForSpecification(relativeSpec, specificationText));
          try {
            const parsed = parseConceptSpecification(specificationText);
            if (!sameSpecification(concept.specification, parsed)) {
              report({
                code: "SPECIFICATION_MISMATCH",
                ref,
                message: `The current specification for ${concept.name} differs from the supplied manifest.`,
              });
            }
            for (const action of parsed.actions) {
              add(
                { kind: "action", concept: concept.name, action: action.name },
                anchorForSpecificationLine(
                  relativeSpec,
                  specificationText,
                  action.location.line,
                  action.location.column,
                ),
              );
            }
            for (const query of parsed.queries) {
              add(
                { kind: "query", concept: concept.name, query: query.name },
                anchorForSpecificationLine(
                  relativeSpec,
                  specificationText,
                  query.location.line,
                  query.location.column,
                ),
              );
            }
          } catch (error) {
            report({
              code: "SPECIFICATION_MISMATCH",
              ref,
              message: `The current specification for ${concept.name} cannot be parsed (${error instanceof Error ? error.message : String(error)}).`,
            });
          }
        }
      }
    }
  }

  const endpointCandidates = declarations.filter(({ kind }) => kind === "endpoint");
  const endpointSourceByReaction = new Map<string, DeclarationCandidate>();
  for (const endpoint of manifest.endpoints) {
    const ref: DesignRef = { kind: "endpoint", endpoint: endpoint.name, path: endpoint.path };
    const matching = endpointCandidates.filter(
      (candidate) =>
        candidate.literal === endpoint.path ||
        (candidate.variable !== undefined && reactionBase(endpoint.name) === candidate.variable),
    );
    const selected = chooseDeclaration(ref, matching, `endpoint ${endpoint.name}`);
    if (selected === undefined) continue;
    add(ref, sourceAnchor(selected, matching.length === 1 ? "literal-name" : "name-and-footprint"));
    for (const reaction of [...manifest.application.reactions, ...manifest.application.unlowered]) {
      if (endpointOwnsReaction(endpoint, reaction.name)) {
        endpointSourceByReaction.set(reaction.name, selected);
      }
    }
  }

  for (const reaction of [...manifest.application.reactions, ...manifest.application.unlowered]) {
    const ref: DesignRef = { kind: "reaction", reaction: reaction.name };
    const endpointSource = endpointSourceByReaction.get(reaction.name);
    if (endpointSource !== undefined) {
      add(ref, sourceAnchor(endpointSource, "manifest-location"));
      continue;
    }
    const base = reactionBase(reaction.name);
    const matching = declarations.filter(
      (candidate) => candidate.kind === "reaction" && candidate.variable === base,
    );
    const selected = chooseDeclaration(
      ref,
      matching,
      `reaction ${reaction.name}`,
      reactionFootprint(reaction),
    );
    if (selected !== undefined) {
      add(
        ref,
        sourceAnchor(selected, matching.length === 1 ? "literal-name" : "name-and-footprint"),
      );
    }
  }

  for (const view of manifest.application.views) {
    const ref: DesignRef = { kind: "view", view: view.name };
    const matching = declarations.filter(
      (candidate) => candidate.kind === "view" && candidate.literal === view.name,
    );
    const selected = chooseDeclaration(ref, matching, `view ${view.name}`);
    if (selected !== undefined) add(ref, sourceAnchor(selected, "literal-name"));
  }

  for (const former of manifest.application.formers) {
    const ref: DesignRef = { kind: "former", former: former.name };
    const matching = declarations.filter(
      (candidate) => candidate.kind === "former" && candidate.literal === former.name,
    );
    const selected = chooseDeclaration(ref, matching, `former ${former.name}`);
    if (selected !== undefined) add(ref, sourceAnchor(selected, "literal-name"));
  }

  return {
    format: "sync-engine.application-source-index",
    version: 1,
    manifestDigest: manifest.digest,
    typescriptVersion: ts.version,
    entries: [...entries.values()]
      .map(({ ref, sources }) => ({
        ref,
        sources: [...sources.values()].sort((left, right) =>
          ordinal(anchorKey(left), anchorKey(right)),
        ),
      }))
      .sort((left, right) => ordinal(designRefKey(left.ref), designRefKey(right.ref))),
    issues: [...issues.values()].sort((left, right) => ordinal(issueKey(left), issueKey(right))),
  };
}
