import { fromMarkdown } from "mdast-util-from-markdown";
import { assertPortableRoutePath } from "@engine/boundary/protocol/route-path";
import {
  AUTHORED_PATH_SEGMENT_SOURCE,
  DESIGN_IDENTIFIER_SOURCE,
} from "@engine/utils/design-identifiers";
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

export interface AuthoredEndpoint {
  identity: string;
  path: string;
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
  endpoints: readonly AuthoredEndpoint[];
  computations: readonly AuthoredComputation[];
  concreteTypes: readonly ConcreteTypeDeclaration[];
  /** Instance declarations authored in this document, with inline bindings attached. */
  instances: readonly AuthoredConceptInstanceDeclaration[];
  /** Bindings authored in detached `bindings` fences. */
  bindings: readonly ExternalTypeBinding[];
}

export interface ConcreteTypeDeclaration {
  name: string;
  definition: string;
  location: DesignSourceLocation;
}

export type BindingPlacement = "inline" | "detached";

export interface ExternalTypeBinding {
  instance: string;
  external: string;
  target:
    | { kind: "concrete"; name: string }
    | { kind: "qualified"; instance: string; type: string };
  placement: BindingPlacement;
  location: DesignSourceLocation;
}

export interface AuthoredConceptInstanceDeclaration {
  definition: string;
  instance: string;
  bindings: readonly ExternalTypeBinding[];
  location: DesignSourceLocation;
}

export interface NormalizedConceptInstance extends AuthoredConceptInstanceDeclaration {
  bindings: readonly ExternalTypeBinding[];
}

const SEGMENT = AUTHORED_PATH_SEGMENT_SOURCE;
const IDENTIFIER = DESIGN_IDENTIFIER_SOURCE;
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

function endpointOf(
  scanned: ScannedMarkdown,
  fence: MarkdownFence,
  signature: DesignSourceLine,
  body: readonly DesignSourceLine[],
): AuthoredEndpoint {
  const match = new RegExp(`^(${SEGMENT}(?:\\.${SEGMENT})*)\\s+at\\s+(\\S+)\\s*$`).exec(
    signature.text,
  );
  if (match === null) {
    fail(scanned, signature.number, "endpoint needs `Declaration.Identity at /path` form");
  }
  const prose = body.find(({ text }) => text.trim() !== "");
  if (prose !== undefined) {
    fail(
      scanned,
      prose.number,
      "endpoints fence accepts declarations only; move explanation prose outside the fence",
    );
  }
  try {
    assertPortableRoutePath(match[2], "endpoint design declaration");
  } catch (error) {
    fail(
      scanned,
      signature.number,
      error instanceof Error ? error.message.replace(/\.$/, "") : "endpoint path is invalid",
    );
  }
  return {
    identity: match[1],
    path: match[2],
    location: at(scanned, signature.number, sourceColumn(fence, signature)),
  };
}

function endpointsOf(scanned: ScannedMarkdown): AuthoredEndpoint[] {
  const endpoints: AuthoredEndpoint[] = [];
  for (const fence of scanned.fences.filter(({ info }) => info === "endpoints")) {
    const groups = declarationGroups(fence);
    if (groups.length === 0) {
      fail(scanned, fence.location.line, "endpoints fence must declare at least one endpoint");
    }
    endpoints.push(
      ...groups.map((group) => endpointOf(scanned, fence, group.signature, group.body)),
    );
  }
  return endpoints;
}

function baseDocument(
  markdown: string,
  source: string,
): { scanned: ScannedMarkdown; document: AuthoredApplicationDesignDocument } {
  const scanned = scanDesignMarkdown(markdown, source);
  const title = exactlyOneH1(scanned).text;
  const concreteTypes = scanned.fences
    .filter(({ info }) => info === "types")
    .flatMap((fence) => concreteTypesOf(scanned, fence));
  const instances = scanned.fences
    .filter(({ info }) => info === "instances")
    .flatMap((fence) => instancesOf(scanned, fence));
  const bindings = scanned.fences
    .filter(({ info }) => info === "bindings")
    .flatMap((fence) => detachedBindingsOf(scanned, fence));
  return {
    scanned,
    document: {
      source,
      title,
      content: scanned.content,
      digest: scanned.digest,
      links: linksOf(scanned),
      endpoints: endpointsOf(scanned),
      computations: computationsOf(scanned),
      concreteTypes,
      instances,
      bindings,
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
    document.endpoints.length === 0 &&
    document.computations.length === 0 &&
    document.concreteTypes.length === 0 &&
    document.instances.length === 0 &&
    document.bindings.length === 0
  ) {
    fail(
      scanned,
      1,
      "registered design document must cite a reaction, view, or former, or define an endpoint, computation, application type, concept instance, or binding",
    );
  }
  return document;
}

function sourceColumn(fence: MarkdownFence, line: DesignSourceLine): number {
  return fence.location.column + (/^[ \t]*/.exec(line.text)?.[0].length ?? 0);
}

function targetOf(
  scanned: ScannedMarkdown,
  line: DesignSourceLine,
  target: string,
): ExternalTypeBinding["target"] {
  const match = new RegExp(`^(${IDENTIFIER})(?:\\.(${IDENTIFIER}))?$`).exec(target);
  if (match === null)
    fail(scanned, line.number, `binding target ${JSON.stringify(target)} is not direct`);
  return match[2] === undefined
    ? { kind: "concrete", name: match[1] }
    : { kind: "qualified", instance: match[1], type: match[2] };
}

function concreteTypesOf(
  scanned: ScannedMarkdown,
  fence: MarkdownFence,
): ConcreteTypeDeclaration[] {
  const concreteTypes: ConcreteTypeDeclaration[] = [];
  for (const group of declarationGroups(fence)) {
    const concrete = new RegExp(`^concrete\\s+(${IDENTIFIER})\\s*$`).exec(group.signature.text);
    if (concrete === null) {
      fail(
        scanned,
        group.signature.number,
        "types fence accepts only `concrete Name` declarations",
      );
    }
    const body = indentedBody(group.body);
    if (body === "")
      fail(
        scanned,
        group.signature.number,
        `concrete type ${JSON.stringify(concrete[1])} needs an indented prose definition`,
      );
    concreteTypes.push({
      name: concrete[1],
      definition: body,
      location: at(scanned, group.signature.number, sourceColumn(fence, group.signature)),
    });
  }
  return concreteTypes;
}

function inlineBindingOf(
  scanned: ScannedMarkdown,
  fence: MarkdownFence,
  instance: string,
  line: DesignSourceLine,
): ExternalTypeBinding {
  const match = new RegExp(
    `^[ \\t]+(${IDENTIFIER})\\s+is\\s+(${IDENTIFIER}(?:\\.${IDENTIFIER})?)\\s*$`,
  ).exec(line.text);
  if (match === null) {
    fail(scanned, line.number, "inline binding needs indented `External is Target` form");
  }
  return {
    instance,
    external: match[1],
    target: targetOf(scanned, line, match[2]),
    placement: "inline",
    location: at(scanned, line.number, sourceColumn(fence, line)),
  };
}

function instancesOf(
  scanned: ScannedMarkdown,
  fence: MarkdownFence,
): AuthoredConceptInstanceDeclaration[] {
  const instances: AuthoredConceptInstanceDeclaration[] = [];
  for (const group of declarationGroups(fence)) {
    const declaration = new RegExp(
      `^instantiate\\s+(${IDENTIFIER})(?:\\s+as\\s+(${IDENTIFIER}))?(\\s+with)?\\s*$`,
    ).exec(group.signature.text);
    if (declaration === null) {
      fail(
        scanned,
        group.signature.number,
        "instances fence needs `instantiate Definition`, optionally followed by `as Instance` and `with`",
      );
    }
    const definition = declaration[1];
    const instance = declaration[2] ?? definition;
    const withBindings = declaration[3] !== undefined;
    const body = group.body.filter(({ text }) => text.trim() !== "");
    if (!withBindings && body.length > 0) {
      fail(
        scanned,
        body[0].number,
        `instance ${JSON.stringify(instance)} has a body without \`with\``,
      );
    }
    if (withBindings && body.length === 0) {
      fail(
        scanned,
        group.signature.number,
        `instance ${JSON.stringify(instance)} has an empty \`with\` block`,
      );
    }
    instances.push({
      definition,
      instance,
      bindings: withBindings
        ? body.map((line) => inlineBindingOf(scanned, fence, instance, line))
        : [],
      location: at(scanned, group.signature.number, sourceColumn(fence, group.signature)),
    });
  }
  return instances;
}

function detachedBindingsOf(scanned: ScannedMarkdown, fence: MarkdownFence): ExternalTypeBinding[] {
  const bindings: ExternalTypeBinding[] = [];
  for (const group of declarationGroups(fence)) {
    const binding = new RegExp(
      `^(${IDENTIFIER})\\.(${IDENTIFIER})\\s+is\\s+(${IDENTIFIER}(?:\\.${IDENTIFIER})?)\\s*$`,
    ).exec(group.signature.text);
    if (binding === null) {
      fail(
        scanned,
        group.signature.number,
        "bindings fence accepts only `Instance.External is Target` declarations",
      );
    }
    const prose = group.body.find(({ text }) => text.trim() !== "");
    if (prose !== undefined) {
      fail(
        scanned,
        prose.number,
        "bindings fence accepts declarations only; move explanation prose outside the fence",
      );
    }
    bindings.push({
      instance: binding[1],
      external: binding[2],
      target: targetOf(scanned, group.signature, binding[3]),
      placement: "detached",
      location: at(scanned, group.signature.number, sourceColumn(fence, group.signature)),
    });
  }
  return bindings;
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
  definition: string;
  externalTypes: readonly string[];
  /**
   * Optional integration result from the structured-SSF owner. Supply the complete
   * normalized owned-name inventory for the selected definition (including structural,
   * subset, safely evidenced alias, and explicit alias names). Configured application checking always supplies
   * this inventory; omission supports isolated form/validator use and makes no ownership
   * claim.
   */
  ownedTypes?: readonly string[];
}

export interface SelectedEndpointDesign {
  identity: string;
  path: string;
}

export interface SelectedApplicationDesign {
  reactions: readonly string[];
  endpoints: readonly SelectedEndpointDesign[];
  views: readonly string[];
  formers: readonly string[];
  computations: readonly SelectedComputationDesign[];
  concepts: readonly SelectedConceptDesign[];
  /** Selected assembly names whose definitions cannot be checked without a specification. */
  unresolvedConceptInstances?: readonly string[];
}

export type ApplicationDesignIssueCode =
  | "UNRESOLVED_LINK"
  | "UNRESOLVED_ENDPOINT"
  | "ENDPOINT_PATH_MISMATCH"
  | "MISSING_COVERAGE"
  | "DUPLICATE_ENDPOINT"
  | "DUPLICATE_COMPUTATION"
  | "UNREGISTERED_COMPUTATION"
  | "COMPUTATION_INPUT_MISMATCH"
  | "DUPLICATE_CONCRETE_TYPE"
  | "DUPLICATE_INSTANCE"
  | "DUPLICATE_EXTERNAL_BINDING"
  | "MIXED_BINDING_PLACEMENT"
  | "UNDECLARED_BINDING_INSTANCE"
  | "UNSELECTED_INSTANCE"
  | "UNDECLARED_SELECTED_INSTANCE"
  | "INSTANCE_DEFINITION_MISMATCH"
  | "UNKNOWN_EXTERNAL_BINDING"
  | "MISSING_EXTERNAL_BINDING"
  | "UNRESOLVED_BINDING_TARGET"
  | "EXTERNAL_BINDING_TARGET"
  | "UNUSED_CONCRETE_TYPE";

export interface ApplicationDesignIssue {
  code: ApplicationDesignIssueCode;
  message: string;
  location?: DesignSourceLocation;
}

export type ApplicationDesignFormIssue = ApplicationDesignIssue & {
  code:
    | "DUPLICATE_ENDPOINT"
    | "DUPLICATE_COMPUTATION"
    | "DUPLICATE_CONCRETE_TYPE"
    | "DUPLICATE_INSTANCE"
    | "DUPLICATE_EXTERNAL_BINDING"
    | "MIXED_BINDING_PLACEMENT";
  location: DesignSourceLocation;
};

function allDeclarations(
  documents: readonly AuthoredApplicationDesignDocument[],
): AuthoredConceptInstanceDeclaration[] {
  return documents.flatMap(({ instances }) => instances);
}

function allBindings(
  documents: readonly AuthoredApplicationDesignDocument[],
): ExternalTypeBinding[] {
  return documents.flatMap(({ instances, bindings }) => [
    ...instances.flatMap((instance) => instance.bindings),
    ...bindings,
  ]);
}

/** Merge valid distributed declarations into the canonical per-instance authored model. */
export function normalizeAuthoredConceptInstances(
  documents: readonly AuthoredApplicationDesignDocument[],
): NormalizedConceptInstance[] {
  const detached = Map.groupBy(
    documents.flatMap(({ bindings }) => bindings),
    ({ instance }) => instance,
  );
  return allDeclarations(documents).map((declaration) => ({
    ...declaration,
    bindings: [...declaration.bindings, ...(detached.get(declaration.instance) ?? [])],
  }));
}

/** Check corpus-wide authored forms that do not require a selected assembly. */
export function validateAuthoredApplicationDesignForm(
  documents: readonly AuthoredApplicationDesignDocument[],
): ApplicationDesignFormIssue[] {
  const issues: ApplicationDesignFormIssue[] = [];
  const endpoints = new Set<string>();
  const computations = new Set<string>();
  const concreteTypes = new Set<string>();
  const instances = new Map<string, AuthoredConceptInstanceDeclaration>();

  for (const document of documents) {
    for (const endpoint of document.endpoints) {
      if (endpoints.has(endpoint.identity)) {
        issues.push({
          code: "DUPLICATE_ENDPOINT",
          message: `endpoint ${JSON.stringify(endpoint.identity)} has more than one authored declaration.`,
          location: endpoint.location,
        });
      } else endpoints.add(endpoint.identity);
    }
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
    for (const declaration of document.instances) {
      if (instances.has(declaration.instance)) {
        issues.push({
          code: "DUPLICATE_INSTANCE",
          message: `instance ${JSON.stringify(declaration.instance)} is instantiated more than once.`,
          location: declaration.location,
        });
      } else instances.set(declaration.instance, declaration);
    }
  }

  const bindingsByInstance = Map.groupBy(allBindings(documents), ({ instance }) => instance);
  for (const [instance, bindings] of bindingsByInstance) {
    const inline = bindings.filter(({ placement }) => placement === "inline");
    const detached = bindings.filter(({ placement }) => placement === "detached");
    const mixed = inline.length > 0 && detached.length > 0;
    if (mixed) {
      issues.push({
        code: "MIXED_BINDING_PLACEMENT",
        message: `instance ${JSON.stringify(instance)} supplies bindings both inline and in detached binding declarations; choose one placement for the instance.`,
        location: detached[0].location,
      });
    }

    // Mixed placement is one repair. Suppress cross-mode duplicate noise, while
    // retaining independently actionable duplicates inside either chosen mode.
    for (const placementBindings of mixed ? [inline, detached] : [bindings]) {
      const seen = new Set<string>();
      for (const binding of placementBindings) {
        if (seen.has(binding.external)) {
          issues.push({
            code: "DUPLICATE_EXTERNAL_BINDING",
            message: `external type ${JSON.stringify(`${instance}.${binding.external}`)} has more than one application binding.`,
            location: binding.location,
          });
        } else seen.add(binding.external);
      }
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
  const formIssues = validateAuthoredApplicationDesignForm(documents);
  const issues: ApplicationDesignIssue[] = [...formIssues];
  const corpus = documents;
  const selectedByKind: Record<Exclude<DesignLinkKind, "computation">, Set<string>> = {
    reaction: new Set(selected.reactions),
    view: new Set(selected.views),
    former: new Set(selected.formers),
  };
  const endpointsSelected = selected.endpoints;
  const selectedEndpoints = new Map(
    endpointsSelected.map((endpoint) => [endpoint.identity, endpoint]),
  );
  const computations = new Map(
    selected.computations.map((computation) => [computation.name, computation]),
  );
  const links = corpus.flatMap(({ links }) => links);
  const endpoints = corpus.flatMap(({ endpoints: declarations }) => declarations);

  for (const endpoint of endpoints) {
    const selectedEndpoint = selectedEndpoints.get(endpoint.identity);
    if (selectedEndpoint === undefined) {
      issues.push({
        code: "UNRESOLVED_ENDPOINT",
        message: `endpoint declaration does not resolve to selected endpoint ${JSON.stringify(endpoint.identity)}.`,
        location: endpoint.location,
      });
    } else if (selectedEndpoint.path !== endpoint.path) {
      issues.push({
        code: "ENDPOINT_PATH_MISMATCH",
        message: `endpoint ${JSON.stringify(endpoint.identity)} is declared at ${JSON.stringify(endpoint.path)}, but the selected endpoint is at ${JSON.stringify(selectedEndpoint.path)}.`,
        location: endpoint.location,
      });
    }
  }

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
  for (const endpoint of endpointsSelected) {
    if (!endpoints.some(({ identity }) => identity === endpoint.identity)) {
      issues.push({
        code: "MISSING_COVERAGE",
        message: `selected endpoint ${JSON.stringify(endpoint.identity)} at ${JSON.stringify(endpoint.path)} has no authored endpoint declaration.`,
      });
    }
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

  const selectedConcepts = new Map(selected.concepts.map((concept) => [concept.instance, concept]));
  const unresolvedConceptInstances = new Set(selected.unresolvedConceptInstances ?? []);
  const locationKey = ({ source, line, column }: DesignSourceLocation): string =>
    `${source}\0${line}\0${column}`;
  const bindingsByInstance = Map.groupBy(allBindings(corpus), ({ instance }) => instance);
  const mixedInstances = new Set(
    [...bindingsByInstance]
      .filter(([, bindings]) => new Set(bindings.map(({ placement }) => placement)).size > 1)
      .map(([instance]) => instance),
  );
  const positiveExternalMixedInstances = new Set(
    [...mixedInstances].filter(
      (instance) => (selectedConcepts.get(instance)?.externalTypes.length ?? 0) > 0,
    ),
  );
  const zeroExternalMixedLocations = new Set(
    [...mixedInstances]
      .filter((instance) => selectedConcepts.get(instance)?.externalTypes.length === 0)
      .flatMap((instance) =>
        (bindingsByInstance.get(instance) ?? []).map(({ location }) => locationKey(location)),
      ),
  );
  const allMixedBindingLocations = new Set(
    [...mixedInstances].flatMap((instance) =>
      (bindingsByInstance.get(instance) ?? []).map(({ location }) => locationKey(location)),
    ),
  );
  for (let index = issues.length - 1; index >= 0; index -= 1) {
    const issue = issues[index];
    if (issue.location === undefined) continue;
    const key = locationKey(issue.location);
    if (
      (issue.code === "MIXED_BINDING_PLACEMENT" && zeroExternalMixedLocations.has(key)) ||
      (issue.code === "DUPLICATE_EXTERNAL_BINDING" && allMixedBindingLocations.has(key))
    ) {
      issues.splice(index, 1);
    }
  }

  const declarations = new Map<string, AuthoredConceptInstanceDeclaration>();
  for (const declaration of allDeclarations(corpus)) {
    if (!declarations.has(declaration.instance))
      declarations.set(declaration.instance, declaration);
  }
  const normalized = new Map<string, NormalizedConceptInstance>();
  for (const instance of normalizeAuthoredConceptInstances(corpus)) {
    if (!normalized.has(instance.instance)) normalized.set(instance.instance, instance);
  }
  const declarationCounts = Map.groupBy(allDeclarations(corpus), ({ instance }) => instance);
  const duplicateInstances = new Set(
    [...declarationCounts].filter(([, values]) => values.length > 1).map(([instance]) => instance),
  );
  const matched = new Set<string>();
  for (const declaration of declarations.values()) {
    const executable = selectedConcepts.get(declaration.instance);
    if (executable === undefined) {
      if (!unresolvedConceptInstances.has(declaration.instance)) {
        issues.push({
          code: "UNSELECTED_INSTANCE",
          message: `authored instance ${JSON.stringify(declaration.instance)} of ${JSON.stringify(declaration.definition)} is not selected by this assembly.`,
          location: declaration.location,
        });
      }
      continue;
    }
    if (declaration.definition !== executable.definition) {
      issues.push({
        code: "INSTANCE_DEFINITION_MISMATCH",
        message: `instance ${JSON.stringify(declaration.instance)} is authored from ${JSON.stringify(declaration.definition)}, but its executable registration defines ${JSON.stringify(executable.definition)}.`,
        location: declaration.location,
      });
      continue;
    }
    matched.add(declaration.instance);
  }
  for (const concept of selected.concepts) {
    if (!declarations.has(concept.instance)) {
      issues.push({
        code: "UNDECLARED_SELECTED_INSTANCE",
        message: `selected instance ${JSON.stringify(concept.instance)} of ${JSON.stringify(concept.definition)} has no authored instantiation.`,
      });
    }
  }
  for (const binding of corpus.flatMap(({ bindings }) => bindings)) {
    if (!declarations.has(binding.instance)) {
      issues.push({
        code: "UNDECLARED_BINDING_INSTANCE",
        message: `detached binding for ${JSON.stringify(`${binding.instance}.${binding.external}`)} has no authored instance declaration.`,
        location: binding.location,
      });
    }
  }

  const concrete = new Map<string, ConcreteTypeDeclaration>();
  for (const declaration of corpus.flatMap(({ concreteTypes }) => concreteTypes)) {
    if (!concrete.has(declaration.name)) concrete.set(declaration.name, declaration);
  }
  const usedConcrete = new Set<string>();
  // A placement or definition repair must not cascade into an unrelated unused-type finding.
  for (const binding of allBindings(corpus)) {
    if (binding.target.kind === "concrete" && concrete.has(binding.target.name)) {
      usedConcrete.add(binding.target.name);
    }
  }

  for (const instance of normalized.values()) {
    if (
      !matched.has(instance.instance) ||
      duplicateInstances.has(instance.instance) ||
      unresolvedConceptInstances.has(instance.instance)
    )
      continue;
    const concept = selectedConcepts.get(instance.instance)!;
    if (positiveExternalMixedInstances.has(instance.instance)) continue;
    const externals = new Set(concept.externalTypes);
    const accepted = new Set<string>();
    for (const binding of instance.bindings) {
      if (!externals.has(binding.external)) {
        issues.push({
          code: "UNKNOWN_EXTERNAL_BINDING",
          message: `instance ${JSON.stringify(instance.instance)} of ${JSON.stringify(instance.definition)} binds ${JSON.stringify(binding.external)}, but the definition declares only ${concept.externalTypes.map((name) => JSON.stringify(name)).join(" and ") || "no types"} as external parameters.`,
          location: binding.location,
        });
        continue;
      }
      if (!accepted.has(binding.external)) accepted.add(binding.external);

      if (binding.target.kind === "concrete") {
        if (!concrete.has(binding.target.name)) {
          issues.push({
            code: "UNRESOLVED_BINDING_TARGET",
            message: `binding target ${JSON.stringify(binding.target.name)} is not a declared concrete type.`,
            location: binding.location,
          });
        } else usedConcrete.add(binding.target.name);
        continue;
      }
      const target = selectedConcepts.get(binding.target.instance);
      if (target === undefined || !matched.has(binding.target.instance)) {
        if (!unresolvedConceptInstances.has(binding.target.instance)) {
          issues.push({
            code: "UNRESOLVED_BINDING_TARGET",
            message:
              target === undefined
                ? `binding target instance ${JSON.stringify(binding.target.instance)} is not selected.`
                : `binding target instance ${JSON.stringify(binding.target.instance)} has no matching authored instantiation.`,
            location: binding.location,
          });
        }
      } else if (target.externalTypes.includes(binding.target.type)) {
        issues.push({
          code: "EXTERNAL_BINDING_TARGET",
          message: `binding target ${JSON.stringify(`${binding.target.instance}.${binding.target.type}`)} is another external parameter; bindings must target a concrete application type or terminate directly at an owned type.`,
          location: binding.location,
        });
      } else if (
        target.ownedTypes !== undefined &&
        !target.ownedTypes.includes(binding.target.type)
      ) {
        issues.push({
          code: "UNRESOLVED_BINDING_TARGET",
          message: `binding target ${JSON.stringify(`${binding.target.instance}.${binding.target.type}`)} is not an owned type reported for definition ${JSON.stringify(target.definition)}.`,
          location: binding.location,
        });
      }
    }
    for (const external of concept.externalTypes) {
      if (!accepted.has(external)) {
        issues.push({
          code: "MISSING_EXTERNAL_BINDING",
          message: `instance ${JSON.stringify(instance.instance)} of ${JSON.stringify(instance.definition)} does not bind external parameter ${JSON.stringify(external)}.`,
          location: instance.location,
        });
      }
    }
  }
  for (const declaration of concrete.values()) {
    if (!usedConcrete.has(declaration.name)) {
      issues.push({
        code: "UNUSED_CONCRETE_TYPE",
        message: `concrete type ${JSON.stringify(declaration.name)} is not used by a binding.`,
        location: declaration.location,
      });
    }
  }
  return issues;
}
