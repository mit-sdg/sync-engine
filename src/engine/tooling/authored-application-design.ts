import { fromMarkdown } from "mdast-util-from-markdown";
import {
  declarationGroups,
  exactlyOneH1,
  indentedBody,
  scanDesignMarkdown,
} from "./markdown-design-source.ts";
import type {
  DesignSourceLine,
  DesignSourceLocation,
  MarkdownFence,
  ScannedMarkdown,
} from "./markdown-design-source.ts";

export type DesignLinkKind = "reaction" | "view" | "former" | "computation";

export interface AuthoredDesignLink {
  kind: DesignLinkKind;
  target: string;
  text: string;
  location: DesignSourceLocation;
}

export interface AuthoredComputationInput {
  name: string;
  optional: boolean;
  type: string;
  location: DesignSourceLocation;
}

export interface AuthoredComputation {
  name: string;
  inputs: readonly AuthoredComputationInput[];
  result: string;
  body: string;
  location: DesignSourceLocation;
}

export interface AuthoredApplicationDesignDocument {
  source: string;
  title: string;
  content: string;
  digest: string;
  links: readonly AuthoredDesignLink[];
  computations: readonly AuthoredComputation[];
  concreteTypes: readonly ConcreteTypeDeclaration[];
  bindings: readonly ExternalTypeBinding[];
}

export interface ConcreteTypeDeclaration {
  name: string;
  definition: string;
  location: DesignSourceLocation;
}

export interface ExternalTypeBinding {
  instance: string;
  external: string;
  target:
    | { kind: "concrete"; name: string }
    | { kind: "qualified"; instance: string; type: string };
  explanation?: string;
  location: DesignSourceLocation;
}

const SEGMENT = "[A-Za-z_][A-Za-z0-9_-]*";
const PATH = new RegExp(`^${SEGMENT}(?:\\.${SEGMENT})*$`);
const COMPUTATION_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const TYPED_DESTINATION = /^(reaction|view|former|computation):(.*)$/;

function at(scanned: ScannedMarkdown, line: number, column = 1): DesignSourceLocation {
  return { source: scanned.source, line, column };
}

function fail(scanned: ScannedMarkdown, line: number, message: string): never {
  throw new Error(`${scanned.source}:${line}: ${message}.`);
}

function typedLink(
  scanned: ScannedMarkdown,
  destination: string,
  text: string,
  line: number,
  column: number,
): AuthoredDesignLink | undefined {
  const typed = TYPED_DESTINATION.exec(destination);
  if (typed === null) return undefined;
  const kind = typed[1] as DesignLinkKind;
  const target = typed[2];
  const valid = kind === "computation" ? COMPUTATION_NAME.test(target) : PATH.test(target);
  if (!valid || target.includes("*")) {
    fail(
      scanned,
      line,
      `${kind} link must name one exact non-wildcard declaration, received ${JSON.stringify(target)}`,
    );
  }
  return { kind, target, text, location: at(scanned, line, column) };
}

interface MarkdownNode {
  type: string;
  children?: readonly MarkdownNode[];
  value?: string;
  alt?: string | null;
  url?: string;
  identifier?: string;
  position?: { start: { line: number; column: number } };
}

function descendants(node: MarkdownNode, visit: (node: MarkdownNode) => void): void {
  visit(node);
  for (const child of node.children ?? []) descendants(child, visit);
}

function textOf(node: MarkdownNode): string {
  if (node.type === "text" || node.type === "inlineCode") return node.value ?? "";
  if (node.type === "image" || node.type === "imageReference") return node.alt ?? "";
  if (node.type === "break") return " ";
  return (node.children ?? []).map(textOf).join("");
}

function linksOf(scanned: ScannedMarkdown): AuthoredDesignLink[] {
  const tree: MarkdownNode = fromMarkdown(scanned.content);
  const definitions = new Map<string, string>();
  descendants(tree, (node) => {
    if (node.type === "definition" && node.identifier !== undefined && node.url !== undefined) {
      // CommonMark resolves duplicate definitions to their first occurrence.
      if (!definitions.has(node.identifier)) definitions.set(node.identifier, node.url);
    }
  });

  const links: AuthoredDesignLink[] = [];
  descendants(tree, (node) => {
    const destination =
      node.type === "link"
        ? node.url
        : node.type === "linkReference" && node.identifier !== undefined
          ? definitions.get(node.identifier)
          : undefined;
    if (destination === undefined || node.position === undefined) return;
    const parsed = typedLink(
      scanned,
      destination,
      textOf(node).trim().replace(/\s+/g, " "),
      node.position.start.line,
      node.position.start.column,
    );
    if (parsed !== undefined) links.push(parsed);
  });
  return links;
}

function splitFields(text: string, scanned: ScannedMarkdown, line: number): string[] {
  const fields: string[] = [];
  let start = 0;
  const stack: string[] = [];
  const pairs: Record<string, string> = { "<": ">", "(": ")", "[": "]", "{": "}" };
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (Object.hasOwn(pairs, character)) stack.push(pairs[character]);
    else if (stack.at(-1) === character) stack.pop();
    else if (character === "," && stack.length === 0) {
      fields.push(text.slice(start, index));
      start = index + 1;
    }
  }
  if (stack.length > 0) fail(scanned, line, "computation input type has unbalanced delimiters");
  fields.push(text.slice(start));
  return fields;
}

function computationOf(
  scanned: ScannedMarkdown,
  signature: DesignSourceLine,
  bodyLines: readonly DesignSourceLine[],
): AuthoredComputation {
  const match = /^([A-Za-z_][A-Za-z0-9_]*)\((.*)\)\s*:\s*(\S(?:.*\S)?)\s*$/.exec(signature.text);
  if (match === null) {
    fail(scanned, signature.number, "computation needs `name(inputs) : Result` signature");
  }
  const body = indentedBody(bodyLines);
  if (body === "")
    fail(
      scanned,
      signature.number,
      `computation ${JSON.stringify(match[1])} needs an indented prose body`,
    );
  const inputs: AuthoredComputationInput[] = [];
  const names = new Set<string>();
  if (match[2].trim() !== "") {
    for (const sourceField of splitFields(match[2], scanned, signature.number)) {
      const field = /^\s*([A-Za-z_][A-Za-z0-9_]*)(\?)?\s*:\s*(\S(?:.*\S)?)\s*$/.exec(sourceField);
      if (field === null)
        fail(
          scanned,
          signature.number,
          `invalid computation input ${JSON.stringify(sourceField.trim())}`,
        );
      if (names.has(field[1]))
        fail(
          scanned,
          signature.number,
          `computation input ${JSON.stringify(field[1])} is declared twice`,
        );
      names.add(field[1]);
      inputs.push({
        name: field[1],
        optional: field[2] !== undefined,
        type: field[3],
        location: at(scanned, signature.number, signature.text.indexOf(field[1]) + 1),
      });
    }
  }
  return {
    name: match[1],
    inputs,
    result: match[3],
    body,
    location: at(scanned, signature.number, 1),
  };
}

function computationsOf(scanned: ScannedMarkdown): AuthoredComputation[] {
  return scanned.fences
    .filter(({ info }) => info === "computations")
    .flatMap((fence) =>
      declarationGroups(fence).map((group) => computationOf(scanned, group.signature, group.body)),
    );
}

function baseDocument(
  markdown: string,
  source: string,
): { scanned: ScannedMarkdown; document: AuthoredApplicationDesignDocument } {
  const scanned = scanDesignMarkdown(markdown, source);
  const title = exactlyOneH1(scanned).text;
  const types = scanned.fences
    .filter(({ info }) => info === "types")
    .map((fence) => typesOf(scanned, fence));
  return {
    scanned,
    document: {
      source,
      title,
      content: scanned.content,
      digest: scanned.digest,
      links: linksOf(scanned),
      computations: computationsOf(scanned),
      concreteTypes: types.flatMap(({ concreteTypes }) => concreteTypes),
      bindings: types.flatMap(({ bindings }) => bindings),
    },
  };
}

/** Parse one explicitly registered application design file. */
export function parseApplicationDesignDocument(
  markdown: string,
  source = "<design>",
): AuthoredApplicationDesignDocument {
  const { scanned, document } = baseDocument(markdown, source);
  if (
    !document.links.some(
      ({ kind }) => kind === "reaction" || kind === "view" || kind === "former",
    ) &&
    document.computations.length === 0 &&
    document.concreteTypes.length === 0 &&
    document.bindings.length === 0
  ) {
    fail(
      scanned,
      1,
      "registered design document must cite a reaction, view, or former, or define a computation or application type",
    );
  }
  return document;
}

function typesOf(
  scanned: ScannedMarkdown,
  fence: MarkdownFence,
): {
  concreteTypes: ConcreteTypeDeclaration[];
  bindings: ExternalTypeBinding[];
} {
  const concreteTypes: ConcreteTypeDeclaration[] = [];
  const bindings: ExternalTypeBinding[] = [];
  for (const group of declarationGroups(fence)) {
    const concrete = new RegExp(`^concrete\\s+(${SEGMENT})\\s*$`).exec(group.signature.text);
    const binding = new RegExp(
      `^(${SEGMENT})\\.(${SEGMENT})\\s+is\\s+(${SEGMENT})(?:\\.(${SEGMENT}))?\\s*$`,
    ).exec(group.signature.text);
    const body = indentedBody(group.body);
    if (concrete !== null) {
      if (body === "")
        fail(
          scanned,
          group.signature.number,
          `concrete type ${JSON.stringify(concrete[1])} needs an indented prose definition`,
        );
      concreteTypes.push({
        name: concrete[1],
        definition: body,
        location: at(scanned, group.signature.number),
      });
      continue;
    }
    if (binding !== null) {
      bindings.push({
        instance: binding[1],
        external: binding[2],
        target:
          binding[4] === undefined
            ? { kind: "concrete", name: binding[3] }
            : { kind: "qualified", instance: binding[3], type: binding[4] },
        ...(body === "" ? {} : { explanation: body }),
        location: at(scanned, group.signature.number),
      });
      continue;
    }
    fail(
      scanned,
      group.signature.number,
      "types fence accepts only `concrete Name` or `Instance.External is Target` declarations",
    );
  }
  return { concreteTypes, bindings };
}

export interface SelectedComputationDesign {
  name: string;
  /**
   * Authoritative TypeScript-source shape, when the caller has resolved it.
   * Runtime parameter reflection cannot establish optionality, so absence means
   * that input-shape agreement is deliberately not claimed.
   */
  inputs?: readonly { name: string; optional: boolean }[];
}

export interface SelectedConceptDesign {
  instance: string;
  externalTypes: readonly string[];
}

export interface SelectedApplicationDesign {
  reactions: readonly string[];
  views: readonly string[];
  formers: readonly string[];
  computations: readonly SelectedComputationDesign[];
  concepts: readonly SelectedConceptDesign[];
}

export type ApplicationDesignIssueCode =
  | "UNRESOLVED_LINK"
  | "MISSING_COVERAGE"
  | "DUPLICATE_COMPUTATION"
  | "UNREGISTERED_COMPUTATION"
  | "COMPUTATION_INPUT_MISMATCH"
  | "DUPLICATE_CONCRETE_TYPE"
  | "DUPLICATE_TYPE_BINDING"
  | "UNKNOWN_EXTERNAL"
  | "MISSING_BINDING"
  | "UNRESOLVED_TYPE_TARGET"
  | "EXTERNAL_TARGET"
  | "UNUSED_CONCRETE";

export interface ApplicationDesignIssue {
  code: ApplicationDesignIssueCode;
  message: string;
  location?: DesignSourceLocation;
}

export type ApplicationDesignFormIssue = ApplicationDesignIssue & {
  code: "DUPLICATE_COMPUTATION" | "DUPLICATE_CONCRETE_TYPE" | "DUPLICATE_TYPE_BINDING";
  location: DesignSourceLocation;
};

/** Check corpus-wide authored forms that do not require a selected assembly. */
export function validateAuthoredApplicationDesignForm(
  documents: readonly AuthoredApplicationDesignDocument[],
): ApplicationDesignFormIssue[] {
  const issues: ApplicationDesignFormIssue[] = [];
  const computations = new Set<string>();
  const concreteTypes = new Set<string>();
  const bindings = new Set<string>();

  for (const document of documents) {
    for (const computation of document.computations) {
      if (computations.has(computation.name)) {
        issues.push({
          code: "DUPLICATE_COMPUTATION",
          message: `computation ${JSON.stringify(computation.name)} has more than one authored definition.`,
          location: computation.location,
        });
      } else computations.add(computation.name);
    }
    for (const declaration of document.concreteTypes) {
      if (concreteTypes.has(declaration.name)) {
        issues.push({
          code: "DUPLICATE_CONCRETE_TYPE",
          message: `concrete type ${JSON.stringify(declaration.name)} has more than one application declaration.`,
          location: declaration.location,
        });
      } else concreteTypes.add(declaration.name);
    }
    for (const binding of document.bindings) {
      const key = `${binding.instance}.${binding.external}`;
      if (bindings.has(key)) {
        issues.push({
          code: "DUPLICATE_TYPE_BINDING",
          message: `external type ${JSON.stringify(key)} has more than one application binding.`,
          location: binding.location,
        });
      } else bindings.add(key);
    }
  }
  return issues;
}

function fieldShape(fields: readonly { name: string; optional: boolean }[]): string {
  return [...fields]
    .sort((left, right) => left.name.localeCompare(right.name))
    .map(({ name, optional }) => `${name}${optional ? "?" : ""}`)
    .join(", ");
}

/**
 * Check parsed documents against the exact selected assembly inventory. The
 * validator returns all independently actionable issues and performs no I/O.
 */
export function validateAuthoredApplicationDesign(
  documents: readonly AuthoredApplicationDesignDocument[],
  selected: SelectedApplicationDesign,
): ApplicationDesignIssue[] {
  const issues: ApplicationDesignIssue[] = [...validateAuthoredApplicationDesignForm(documents)];
  const corpus = documents;
  const selectedByKind: Record<Exclude<DesignLinkKind, "computation">, Set<string>> = {
    reaction: new Set(selected.reactions),
    view: new Set(selected.views),
    former: new Set(selected.formers),
  };
  const computations = new Map(
    selected.computations.map((computation) => [computation.name, computation]),
  );
  const links = corpus.flatMap(({ links }) => links);

  for (const link of links) {
    const resolved =
      link.kind === "computation"
        ? computations.has(link.target)
        : selectedByKind[link.kind].has(link.target);
    if (!resolved)
      issues.push({
        code: "UNRESOLVED_LINK",
        message: `${link.kind} link does not resolve to selected declaration ${JSON.stringify(link.target)}.`,
        location: link.location,
      });
  }
  for (const kind of ["reaction", "view", "former"] as const) {
    for (const name of selectedByKind[kind]) {
      if (!links.some((link) => link.kind === kind && link.target === name)) {
        issues.push({
          code: "MISSING_COVERAGE",
          message: `selected ${kind} ${JSON.stringify(name)} has no authored design link.`,
        });
      }
    }
  }

  const authoredComputations = new Map<string, AuthoredComputation>();
  for (const computation of corpus.flatMap(({ computations: declared }) => declared)) {
    const previous = authoredComputations.get(computation.name);
    if (previous !== undefined) continue;
    authoredComputations.set(computation.name, computation);
    const executable = computations.get(computation.name);
    if (executable === undefined) {
      issues.push({
        code: "UNREGISTERED_COMPUTATION",
        message: `authored computation ${JSON.stringify(computation.name)} is not selected.`,
        location: computation.location,
      });
    } else if (
      executable.inputs !== undefined &&
      fieldShape(computation.inputs) !== fieldShape(executable.inputs)
    ) {
      issues.push({
        code: "COMPUTATION_INPUT_MISMATCH",
        message: `computation ${JSON.stringify(computation.name)} declares inputs (${fieldShape(computation.inputs)}), but executable inputs are (${fieldShape(executable.inputs)}).`,
        location: computation.location,
      });
    }
  }
  for (const computation of selected.computations) {
    if (!authoredComputations.has(computation.name)) {
      issues.push({
        code: "MISSING_COVERAGE",
        message: `selected computation ${JSON.stringify(computation.name)} has no authored definition.`,
      });
    }
  }

  const concepts = new Map(
    selected.concepts.map((concept) => [concept.instance, new Set(concept.externalTypes)]),
  );
  const concrete = new Map<string, ConcreteTypeDeclaration>();
  for (const declaration of corpus.flatMap(({ concreteTypes }) => concreteTypes)) {
    if (concrete.has(declaration.name)) continue;
    concrete.set(declaration.name, declaration);
  }

  const usedConcrete = new Set<string>();
  const bindings = new Map<string, ExternalTypeBinding>();
  for (const binding of corpus.flatMap(({ bindings: declared }) => declared)) {
    const externals = concepts.get(binding.instance);
    const key = `${binding.instance}.${binding.external}`;
    if (!bindings.has(key) && externals !== undefined && externals.has(binding.external)) {
      bindings.set(key, binding);
    }
    if (externals === undefined || !externals.has(binding.external)) {
      issues.push({
        code: "UNKNOWN_EXTERNAL",
        message: `binding left side ${JSON.stringify(key)} is not a selected external type.`,
        location: binding.location,
      });
    }

    if (binding.target.kind === "concrete") {
      if (!concrete.has(binding.target.name)) {
        issues.push({
          code: "UNRESOLVED_TYPE_TARGET",
          message: `binding target ${JSON.stringify(binding.target.name)} is not a declared concrete type.`,
          location: binding.location,
        });
      } else usedConcrete.add(binding.target.name);
    } else {
      const targetExternals = concepts.get(binding.target.instance);
      if (targetExternals === undefined) {
        issues.push({
          code: "UNRESOLVED_TYPE_TARGET",
          message: `binding target instance ${JSON.stringify(binding.target.instance)} is not selected.`,
          location: binding.location,
        });
      } else if (targetExternals.has(binding.target.type)) {
        issues.push({
          code: "EXTERNAL_TARGET",
          message: `binding target ${JSON.stringify(`${binding.target.instance}.${binding.target.type}`)} is another external parameter.`,
          location: binding.location,
        });
      }
    }
  }
  for (const [instance, externals] of concepts) {
    for (const external of externals) {
      const key = `${instance}.${external}`;
      if (!bindings.has(key))
        issues.push({
          code: "MISSING_BINDING",
          message: `selected external type ${JSON.stringify(key)} has no application type binding.`,
        });
    }
  }
  for (const declaration of concrete.values()) {
    if (!usedConcrete.has(declaration.name)) {
      issues.push({
        code: "UNUSED_CONCRETE",
        message: `concrete type ${JSON.stringify(declaration.name)} is not used by a binding.`,
        location: declaration.location,
      });
    }
  }
  return issues;
}
