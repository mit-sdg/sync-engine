/** Config-level orchestration for one selected application's authored design. */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Assembly } from "@engine/boundary/assembly/assembly-facade";
import { assemblyBehind } from "@engine/boundary/assembly/assembly-registry";
import type { AuthoredDeclarationIdentity } from "@engine/reads/declaration-identity";
import {
  parseSpec,
  specificationsAreCompatible,
  specificationSourceDigest,
  type ConceptSpec,
} from "@engine/reactions/concepts/concept-spec";
import { canonicalDigest } from "@engine/utils/canonical-json";
import { ordinal } from "@engine/utils/ordinal";
import {
  parseApplicationDesignDocument,
  parseApplicationVocabularyDocument,
  validateAuthoredApplicationDesign,
} from "./authored-application-design.ts";
import type {
  ApplicationDesignIssue,
  AuthoredApplicationDesignDocument,
  AuthoredVocabularyDocument,
  DesignLinkKind,
  SelectedApplicationDesign,
} from "./authored-application-design.ts";
import { scanDesignMarkdown } from "./markdown-design-source.ts";
import type { DesignSourceLine, DesignSourceLocation } from "./markdown-design-source.ts";

export interface AuthoredDesignRegistration {
  vocabulary?: URL;
  documents: readonly URL[];
}

/** One registered file, read once and retained in its normalized full form. */
export interface LoadedAuthoredDesignSource {
  url: URL;
  path: string;
  content: string;
  digest: string;
  lines: readonly DesignSourceLine[];
}

/** Required static-source adapter input for config-generated concept provenance. */
export interface ConceptSpecificationSourceInput {
  instance: string;
  url: URL;
  /** Exact text traced from the default Markdown import; no second file read is performed. */
  content: string;
}

export interface LoadedConceptSpecificationSource extends LoadedAuthoredDesignSource {
  instance: string;
  definition: string;
  definitionLine: number;
}

export interface AuthoritativeComputationInput {
  name: string;
  inputs: readonly { name: string; optional: boolean }[];
}

export interface ComputationInputAnalysisContext {
  assembly: Assembly<Record<string, new (...args: never[]) => object>>;
  /** Vocabulary-owned executable computations selected by this assembly. */
  computations: readonly { name: string }[];
}

/**
 * Injection point for source analysis that can prove TypeScript field names and
 * optionality. The orchestrator never substitutes runtime parameter reflection:
 * reflection can observe some names but cannot prove optionality.
 */
export type ResolveComputationInputs = (
  context: ComputationInputAnalysisContext,
) => readonly AuthoritativeComputationInput[] | Promise<readonly AuthoritativeComputationInput[]>;

export interface AuthoredDeclarationCoverage {
  kind: DesignLinkKind;
  identity: string;
  locations: readonly DesignSourceLocation[];
}

export interface SelectedConceptDesignFact {
  instance: string;
  definition: string;
  externalParameters: readonly string[];
  specification: ConceptSpec;
}

/** Equality is over canonical specification content with source positions removed. */
export interface SharedDefinitionEqualityFact {
  definition: string;
  instances: readonly string[];
  specificationDigest: string;
  canonicallyEqual: true;
}

export interface CheckedAuthoredDesignModel {
  sources: {
    vocabulary?: LoadedAuthoredDesignSource;
    documents: readonly LoadedAuthoredDesignSource[];
    /** Present when a strict static-source adapter supplied every selected concept source. */
    concepts?: readonly LoadedConceptSpecificationSource[];
  };
  documents: readonly AuthoredApplicationDesignDocument[];
  /** Parsed declarations only; qualified targets make no unparsed SSF ownership claim. */
  vocabulary?: AuthoredVocabularyDocument;
  /** Exact authored declaration inventory, retaining endpoint source identities. */
  declarations: readonly AuthoredDeclarationIdentity[];
  /** Projection consumed by the existing pure coverage/vocabulary validator. */
  selected: SelectedApplicationDesign;
  concepts: readonly SelectedConceptDesignFact[];
  sharedDefinitions: readonly SharedDefinitionEqualityFact[];
  coverage: readonly AuthoredDeclarationCoverage[];
  /** Explicitly records whether authoritative source analysis covered each computation. */
  computationInputValidation: readonly {
    name: string;
    status: "validated" | "not-claimed";
  }[];
}

export type AuthoredDesignOrchestrationIssue =
  | ApplicationDesignIssue
  | {
      code: "MISSING_CONCEPT_SPECIFICATION" | "INCOMPATIBLE_SHARED_DEFINITION";
      message: string;
      location?: never;
    };

function issueOrder(
  left: AuthoredDesignOrchestrationIssue,
  right: AuthoredDesignOrchestrationIssue,
): number {
  const leftLocation = left.location;
  const rightLocation = right.location;
  if (leftLocation !== undefined || rightLocation !== undefined) {
    if (leftLocation === undefined) return 1;
    if (rightLocation === undefined) return -1;
    const source = ordinal(leftLocation.source, rightLocation.source);
    if (source !== 0) return source;
    if (leftLocation.line !== rightLocation.line) return leftLocation.line - rightLocation.line;
    if (leftLocation.column !== rightLocation.column)
      return leftLocation.column - rightLocation.column;
  }
  return ordinal(`${left.code}\0${left.message}`, `${right.code}\0${right.message}`);
}

export class AuthoredDesignCheckError extends Error {
  readonly issues: readonly AuthoredDesignOrchestrationIssue[];

  constructor(issues: readonly AuthoredDesignOrchestrationIssue[]) {
    const ordered = [...issues].sort(issueOrder);
    super(
      `authored application design has ${ordered.length} issue${ordered.length === 1 ? "" : "s"}:\n` +
        ordered
          .map(({ code, message, location }) => {
            const at =
              location === undefined
                ? ""
                : `${location.source}:${location.line}:${location.column}: `;
            return `- ${at}[${code}] ${message}`;
          })
          .join("\n"),
    );
    this.name = "AuthoredDesignCheckError";
    this.issues = ordered;
  }
}

function localPath(url: URL, label: string): string {
  if (!(url instanceof URL) || url.protocol !== "file:") {
    const protocol = url instanceof URL ? url.protocol : "non-URL value";
    throw new Error(`authored design: ${label} must be a local file URL, not ${protocol}.`);
  }
  return fileURLToPath(url);
}

async function loadSource(url: URL, label: string): Promise<LoadedAuthoredDesignSource> {
  const path = localPath(url, label);
  const scanned = scanDesignMarkdown(await readFile(path, "utf8"), path);
  return {
    url,
    path,
    content: scanned.content,
    digest: scanned.digest,
    lines: scanned.lines,
  };
}

async function loadRegistration(registration: AuthoredDesignRegistration): Promise<{
  vocabulary?: LoadedAuthoredDesignSource;
  documents: LoadedAuthoredDesignSource[];
}> {
  const entries = [
    ...(registration.vocabulary === undefined
      ? []
      : [{ url: registration.vocabulary, label: "design.vocabulary", vocabulary: true as const }]),
    ...registration.documents.map((url, index) => ({
      url,
      label: `design.documents[${index}]`,
      vocabulary: false as const,
    })),
  ];
  const paths = new Map<string, string>();
  for (const entry of entries) {
    const path = localPath(entry.url, entry.label);
    const previous = paths.get(path);
    if (previous !== undefined) {
      throw new Error(`authored design: ${entry.label} duplicates ${previous}: ${path}.`);
    }
    paths.set(path, entry.label);
  }

  // There is exactly one readFile call for every validated, distinct local URL.
  const loaded = await Promise.all(entries.map((entry) => loadSource(entry.url, entry.label)));
  const vocabularyIndex = entries.findIndex(({ vocabulary }) => vocabulary);
  return {
    ...(vocabularyIndex < 0 ? {} : { vocabulary: loaded[vocabularyIndex] }),
    documents: loaded.filter((_, index) => !entries[index].vocabulary),
  };
}

function withoutLocations(specification: ConceptSpec): unknown {
  return JSON.parse(
    JSON.stringify(specification, (key, value) => (key === "location" ? undefined : value)),
  ) as unknown;
}

function coverageOf(
  selected: SelectedApplicationDesign,
  corpus: readonly AuthoredApplicationDesignDocument[],
): AuthoredDeclarationCoverage[] {
  const entries: AuthoredDeclarationCoverage[] = [];
  for (const [kind, identities] of [
    ["reaction", selected.reactions],
    ["view", selected.views],
    ["former", selected.formers],
  ] as const) {
    for (const identity of identities) {
      entries.push({
        kind,
        identity,
        locations: corpus
          .flatMap(({ links }) => links)
          .filter((link) => link.kind === kind && link.target === identity)
          .map(({ location }) => location),
      });
    }
  }
  for (const computation of selected.computations) {
    const declarations = corpus.flatMap(({ computations }) => computations);
    const links = corpus.flatMap(({ links }) => links);
    entries.push({
      kind: "computation",
      identity: computation.name,
      locations: [
        ...declarations
          .filter(({ name }) => name === computation.name)
          .map(({ location }) => location),
        ...links
          .filter(({ kind, target }) => kind === "computation" && target === computation.name)
          .map(({ location }) => location),
      ].sort((left, right) =>
        issueOrder(
          { code: "MISSING_COVERAGE", message: "", location: left },
          { code: "MISSING_COVERAGE", message: "", location: right },
        ),
      ),
    });
  }
  return entries;
}

/** Load, parse, select, and check the authored design for exactly one assembly. */
export async function checkAuthoredDesign(options: {
  assembly: Assembly<Record<string, new (...args: never[]) => object>>;
  design: AuthoredDesignRegistration;
  resolveComputationInputs?: ResolveComputationInputs;
  conceptSources?: readonly ConceptSpecificationSourceInput[];
}): Promise<CheckedAuthoredDesignModel> {
  const sources = await loadRegistration(options.design);
  const documents = sources.documents.map((source) =>
    parseApplicationDesignDocument(source.content, source.path),
  );
  const vocabulary =
    sources.vocabulary === undefined
      ? undefined
      : parseApplicationVocabularyDocument(sources.vocabulary.content, sources.vocabulary.path);

  const assembled = assemblyBehind(options.assembly);
  const declarations = assembled.authoredDeclarations;
  const executableComputations = assembled.computations
    .filter(({ source }) => source === "vocabulary")
    .map(({ name }) => ({ name }))
    .sort((left, right) => ordinal(left.name, right.name));
  const analyzed =
    options.resolveComputationInputs === undefined
      ? []
      : await options.resolveComputationInputs({
          assembly: options.assembly,
          computations: executableComputations,
        });
  const analyzedNames = new Set<string>();
  const executableNames = new Set(executableComputations.map(({ name }) => name));
  for (const item of analyzed) {
    if (analyzedNames.has(item.name)) {
      throw new Error(
        `authored design: computation input adapter returned ${JSON.stringify(item.name)} more than once.`,
      );
    }
    if (!executableNames.has(item.name)) {
      throw new Error(
        `authored design: computation input adapter returned unselected computation ${JSON.stringify(item.name)}.`,
      );
    }
    analyzedNames.add(item.name);
  }
  const inputsByComputation = new Map(analyzed.map(({ name, inputs }) => [name, inputs]));

  const concepts: SelectedConceptDesignFact[] = [];
  const orchestrationIssues: AuthoredDesignOrchestrationIssue[] = [];
  for (const inventory of assembled.engine
    .exportConcepts()
    .filter(({ name }) => name !== "RequestBoundary")
    .sort((left, right) => ordinal(left.name, right.name))) {
    if (inventory.specification === undefined) {
      orchestrationIssues.push({
        code: "MISSING_CONCEPT_SPECIFICATION",
        message: `selected concept instance ${JSON.stringify(inventory.name)} has no authored concept specification.`,
      });
      continue;
    }
    concepts.push({
      instance: inventory.name,
      definition: inventory.specification.definitionName,
      externalParameters: inventory.specification.externalTypes
        .map(({ name }) => name)
        .sort(ordinal),
      specification: inventory.specification,
    });
  }

  const sharedDefinitions: SharedDefinitionEqualityFact[] = [];
  const byDefinition = Map.groupBy(concepts, ({ definition }) => definition);
  for (const [definition, instances] of [...byDefinition].sort(([left], [right]) =>
    ordinal(left, right),
  )) {
    const canonical = instances[0].specification;
    if (
      instances.some(({ specification }) => !specificationsAreCompatible(canonical, specification))
    ) {
      orchestrationIssues.push({
        code: "INCOMPATIBLE_SHARED_DEFINITION",
        message: `selected instances ${instances.map(({ instance }) => JSON.stringify(instance)).join(", ")} use incompatible specifications for definition ${JSON.stringify(definition)}.`,
      });
      continue;
    }
    sharedDefinitions.push({
      definition,
      instances: instances.map(({ instance }) => instance).sort(ordinal),
      specificationDigest: canonicalDigest(withoutLocations(canonical)),
      canonicallyEqual: true,
    });
  }

  let conceptSources: LoadedConceptSpecificationSource[] | undefined;
  if (options.conceptSources !== undefined) {
    const supplied = new Map<string, ConceptSpecificationSourceInput>();
    for (const source of options.conceptSources) {
      if (supplied.has(source.instance)) {
        throw new Error(
          `authored design: concept source adapter returned ${JSON.stringify(source.instance)} more than once.`,
        );
      }
      supplied.set(source.instance, source);
    }
    conceptSources = concepts.map(({ instance, definition, specification }) => {
      const source = supplied.get(instance);
      if (source === undefined) {
        throw new Error(
          `authored design: concept source adapter omitted selected instance ${JSON.stringify(instance)}.`,
        );
      }
      const path = localPath(source.url, `conceptSources[${JSON.stringify(instance)}].url`);
      const scanned = scanDesignMarkdown(source.content, path);
      parseSpec(scanned.content);
      if (scanned.digest !== specificationSourceDigest(specification)) {
        throw new Error(
          `authored design: traced concept source for ${JSON.stringify(instance)} does not exactly match its registered spec text.`,
        );
      }
      return {
        instance,
        definition,
        definitionLine: scanned.headings.find(({ level }) => level === 1)?.location.line ?? 1,
        url: source.url,
        path,
        content: scanned.content,
        digest: scanned.digest,
        lines: scanned.lines,
      };
    });
    const selectedNames = new Set(concepts.map(({ instance }) => instance));
    const extra = options.conceptSources.find(({ instance }) => !selectedNames.has(instance));
    if (extra !== undefined) {
      throw new Error(
        `authored design: concept source adapter supplied unselected instance ${JSON.stringify(extra.instance)}.`,
      );
    }
  }

  const selected: SelectedApplicationDesign = {
    reactions: declarations
      .filter(({ kind }) => kind === "reaction")
      .map(({ identity }) => identity)
      .sort(ordinal),
    views: declarations
      .filter(({ kind }) => kind === "view")
      .map(({ identity }) => identity)
      .sort(ordinal),
    formers: declarations
      .filter(({ kind }) => kind === "former")
      .map(({ identity }) => identity)
      .sort(ordinal),
    computations: executableComputations.map(({ name }) => ({
      name,
      ...(inputsByComputation.has(name) ? { inputs: inputsByComputation.get(name) } : {}),
    })),
    concepts: concepts.map(({ instance, externalParameters }) => ({
      instance,
      externalTypes: externalParameters,
    })),
  };

  const validationIssues = validateAuthoredApplicationDesign(documents, vocabulary, selected);
  const issues = [...orchestrationIssues, ...validationIssues];
  if (issues.length > 0) throw new AuthoredDesignCheckError(issues);

  const corpus = vocabulary === undefined ? documents : [...documents, vocabulary];
  return {
    sources: { ...sources, ...(conceptSources === undefined ? {} : { concepts: conceptSources }) },
    documents,
    ...(vocabulary === undefined ? {} : { vocabulary }),
    declarations,
    selected,
    concepts,
    sharedDefinitions,
    coverage: coverageOf(selected, corpus),
    computationInputValidation: executableComputations.map(({ name }) => ({
      name,
      status: inputsByComputation.has(name) ? "validated" : "not-claimed",
    })),
  };
}
