import type { Assembly } from "@engine/boundary/assembly/assembly-facade";
import { assemblyBehind } from "@engine/boundary/assembly/assembly-registry";
import type { InputContractDecl } from "@engine/boundary/protocol/endpoints";
import { wireContracts } from "@engine/boundary/wire/wire-contracts";
import type { WireContractsIR } from "@engine/boundary/wire/wire-contracts";
import type { AuthoredDeclarationIdentity } from "@engine/reads/declaration-identity";
import type {
  AppIR,
  ComputationInventoryIR,
  ConceptImplementationProvenanceIR,
  ConceptInventoryIR,
  ConceptSpecificationIR,
  FormerIR,
  ViewIR,
} from "@engine/reads/ir";
import { foldFormerNode } from "@engine/reads/schema";
import { canonicalDigest, canonicalJson, canonicalValue } from "@engine/utils/canonical-json";
import { ordinal } from "@engine/utils/ordinal";
import { GENERATOR_IDENTITY, type GeneratorIdentity } from "@engine/utils/package-version";
import type {
  CheckedAuthoredDesignModel,
  LoadedConceptSpecificationSource,
} from "./authored-design-orchestration.ts";
import type { DesignSourceLocation } from "./markdown-design-source.ts";
import type { ApplicationDiagnostic } from "./diagnostics.ts";
import { applicationDiagnostics } from "./diagnostics.ts";

export interface ManifestEndpointV1 {
  name: string;
  path: string;
  reactions: string[];
  input: InputContractDecl;
  validators: { input: boolean; output: boolean; domainError?: true };
}

export interface ManifestSourceV1 {
  id: string;
  kind: "document" | "concept";
  /** Host-independent path, relative to the generated read-back file. */
  path: string;
  digest: string;
  title?: string;
  definition?: string;
  /** One-based line used when linking directly to a source-owned definition. */
  line?: number;
}

export interface ManifestSourceLocationV1 {
  source: string;
  line: number;
  column: number;
}

export interface ManifestDeclarationV1 extends AuthoredDeclarationIdentity {
  /** Runtime lookup names are deliberately separate from the authored identity. */
  runtimeNames: string[];
  coverage: ManifestSourceLocationV1[];
}

export interface ManifestConceptDefinitionV1 {
  definition: string;
  source?: string;
  specification: ConceptSpecificationIR;
  instances: {
    name: string;
    bindings: {
      external: string;
      target:
        | { kind: "concrete"; name: string }
        | { kind: "qualified"; instance: string; type: string };
      location: ManifestSourceLocationV1;
    }[];
  }[];
}

export interface ManifestComputationDeclarationV1 {
  name: string;
  inputs: { name: string; optional: boolean; type: string }[];
  result: string;
  location: ManifestSourceLocationV1;
  runtimeInputs?: string[];
  inputValidation: "validated" | "not-claimed";
}

export interface ApplicationDesignManifestV1 {
  version: 1;
  checked: boolean;
  sources: ManifestSourceV1[];
  declarations: ManifestDeclarationV1[];
  concepts: ManifestConceptDefinitionV1[];
  types?: {
    concreteTypes: { name: string; location: ManifestSourceLocationV1 }[];
    bindings: {
      instance: string;
      external: string;
      target:
        | { kind: "concrete"; name: string }
        | { kind: "qualified"; instance: string; type: string };
      location: ManifestSourceLocationV1;
    }[];
  };
  computations: ManifestComputationDeclarationV1[];
}

export interface ApplicationManifestV1 {
  format: "sync-engine.application-manifest";
  version: 1;
  generator: GeneratorIdentity;
  digest: string;
  application: AppIR;
  concepts: ConceptInventoryIR[];
  computations: ComputationInventoryIR[];
  conceptImplementations: ConceptImplementationProvenanceIR[];
  endpoints: ManifestEndpointV1[];
  inputContracts: Record<string, InputContractDecl>;
  wire: WireContractsIR;
  diagnostics: ApplicationDiagnostic[];
  design: ApplicationDesignManifestV1;
}

/** Assembly-only facts. Config-only authored design is intentionally absent. */
export type ApplicationAssemblyFacts = Omit<
  ApplicationManifestV1,
  "format" | "version" | "generator" | "digest" | "design"
>;

export interface ManifestSourcePaths {
  /** Convert an absolute checked source path to a read-back-relative POSIX path. */
  relativePath(path: string): string;
}

const configuredAuthoredDesign = new WeakMap<
  object,
  { checked: CheckedAuthoredDesignModel; paths: ManifestSourcePaths }
>();

/** Attach the one checked config model to its exact assembly for all generated consumers. */
export function registerConfiguredAuthoredDesign(
  assembly: Assembly<Record<string, new (...args: never[]) => object>>,
  authored: { checked: CheckedAuthoredDesignModel; paths: ManifestSourcePaths },
): void {
  configuredAuthoredDesign.set(assembly, authored);
}

const INTERNAL_BOUNDARY_ACTIONS = new Set(["register", "cancel", "respondFramework"]);

function sortByName<T extends { name: string }>(values: readonly T[]): T[] {
  return [...values].sort((left, right) => ordinal(left.name, right.name));
}

function stableByDependency<T extends { name: string }>(
  values: readonly T[],
  dependenciesOf: (value: T) => Iterable<string>,
): T[] {
  const byName = new Map(values.map((value) => [value.name, value]));
  const emitted = new Set<string>();
  const visiting = new Set<string>();
  const result: T[] = [];
  const visit = (value: T) => {
    if (emitted.has(value.name) || visiting.has(value.name)) return;
    visiting.add(value.name);
    for (const name of [...new Set(dependenciesOf(value))].sort(ordinal)) {
      const dependency = byName.get(name);
      if (dependency !== undefined) visit(dependency);
    }
    visiting.delete(value.name);
    emitted.add(value.name);
    result.push(value);
  };
  for (const value of sortByName(values)) visit(value);
  return result;
}

function stableViews(views: readonly ViewIR[]): ViewIR[] {
  return stableByDependency(views, (view) =>
    view.alternatives.flatMap((block) =>
      block.flatMap((op) => ("view" in op && typeof op.view === "string" ? [op.view] : [])),
    ),
  );
}

function stableFormers(formers: readonly FormerIR[]): FormerIR[] {
  return stableByDependency(formers, (former) => {
    const dependencies = new Set<string>();
    foldFormerNode(former.body, {
      node: (node) => {
        if (node.node === "former") dependencies.add(node.former);
      },
      splice: ({ fragment }) => dependencies.add(fragment),
    });
    return dependencies;
  });
}

function stableApp(app: AppIR): AppIR {
  return {
    reactions: sortByName(app.reactions),
    views: stableViews(app.views),
    formers: stableFormers(app.formers),
    unlowered: sortByName(app.unlowered),
  };
}

function stableConcepts(concepts: readonly ConceptInventoryIR[]): ConceptInventoryIR[] {
  return sortByName(concepts).map((concept) => ({
    ...concept,
    actions: sortByName(concept.actions)
      .filter(
        ({ name }) => concept.name !== "RequestBoundary" || !INTERNAL_BOUNDARY_ACTIONS.has(name),
      )
      .map((action) => ({
        ...action,
        ...(action.roles === undefined ? {} : { roles: [...new Set(action.roles)].sort(ordinal) }),
        ...(action.refusals === undefined ? {} : { refusals: [...action.refusals].sort(ordinal) }),
      })),
    queries: sortByName(concept.queries).map((query) => ({
      ...query,
      ...(query.roles === undefined ? {} : { roles: [...new Set(query.roles)].sort(ordinal) }),
    })),
  }));
}

/** Read the assembly registry exactly once and derive only executable assembly facts. */
export function applicationAssemblyFacts(
  assembly: Assembly<Record<string, new (...args: never[]) => object>>,
): ApplicationAssemblyFacts {
  const assembled = assemblyBehind(assembly);
  const application = stableApp(assembled.engine.exportReactions());
  const concepts = stableConcepts(assembled.engine.exportConcepts());
  const computations = sortByName(assembled.computations).map((computation) => ({
    ...computation,
    ...(computation.inputs === undefined ? {} : { inputs: [...computation.inputs] }),
  }));
  const conceptImplementations = [...assembled.conceptImplementations].sort((left, right) =>
    ordinal(left.concept, right.concept),
  );
  const wire = wireContracts(application, {
    contracts: assembled.contracts,
    inventories: concepts,
  });
  const endpoints = assembled.endpoints
    .map(({ name, path, reactions }) => ({
      name,
      path,
      reactions: [...reactions].sort(ordinal),
      input: assembled.contracts[path] ?? {},
      validators: {
        input: assembled.validators[path]?.input !== undefined,
        output: assembled.validators[path]?.output !== undefined,
        ...(assembled.validators[path]?.domainError === undefined
          ? {}
          : { domainError: true as const }),
      },
    }))
    .sort((left, right) => ordinal(`${left.path}\0${left.name}`, `${right.path}\0${right.name}`));
  return {
    application,
    concepts,
    computations,
    conceptImplementations,
    endpoints,
    inputContracts: assembled.contracts,
    wire,
    diagnostics: applicationDiagnostics(application, assembled.endpoints, wire),
  };
}

function location(
  value: DesignSourceLocation,
  sourceIds: ReadonlyMap<string, string>,
): ManifestSourceLocationV1 {
  const source = sourceIds.get(value.source);
  if (source === undefined)
    throw new Error(
      `application manifest: unregistered design source ${JSON.stringify(value.source)}.`,
    );
  return { source, line: value.line, column: value.column };
}

function sourceId(kind: ManifestSourceV1["kind"], index: number): string {
  return `${kind}-${index + 1}`;
}

function runtimeNames(app: AppIR, declaration: AuthoredDeclarationIdentity): string[] {
  const values =
    declaration.kind === "reaction"
      ? [...app.reactions, ...app.unlowered]
      : declaration.kind === "view"
        ? app.views
        : app.formers;
  return values
    .filter(
      ({ authored }) =>
        authored?.kind === declaration.kind && authored.identity === declaration.identity,
    )
    .map(({ name }) => name)
    .sort(ordinal);
}

function checkedDesign(
  facts: ApplicationAssemblyFacts,
  checked: CheckedAuthoredDesignModel,
  paths: ManifestSourcePaths,
): ApplicationDesignManifestV1 {
  const sources: ManifestSourceV1[] = [];
  const sourceIds = new Map<string, string>();
  const add = (
    kind: ManifestSourceV1["kind"],
    path: string,
    digest: string,
    extra: Partial<ManifestSourceV1> = {},
  ) => {
    const id = sourceId(kind, sources.filter((source) => source.kind === kind).length);
    sourceIds.set(path, id);
    sources.push({ id, kind, path: paths.relativePath(path), digest, ...extra });
    return id;
  };
  checked.sources.documents.forEach((source, index) =>
    add("document", source.path, source.digest, { title: checked.documents[index]?.title }),
  );
  const conceptSourceByInstance = new Map<string, LoadedConceptSpecificationSource>();
  for (const source of checked.sources.concepts ?? []) {
    conceptSourceByInstance.set(source.instance, source);
    if (!sourceIds.has(source.path))
      add("concept", source.path, source.digest, {
        definition: source.definition,
        line: source.definitionLine,
      });
  }

  const declarations = checked.declarations.map((declaration) => ({
    ...declaration,
    runtimeNames: runtimeNames(facts.application, declaration),
    coverage: (
      checked.coverage.find(
        ({ kind, identity }) => kind === declaration.kind && identity === declaration.identity,
      )?.locations ?? []
    ).map((item) => location(item, sourceIds)),
  }));
  const bindings = checked.documents.flatMap(({ bindings: declared }) => declared);
  const concepts = checked.sharedDefinitions.map((shared) => {
    const selected = checked.concepts.filter(({ definition }) => definition === shared.definition);
    const first = selected[0];
    const source = selected
      .map(({ instance }) => conceptSourceByInstance.get(instance))
      .find((item) => item !== undefined);
    return {
      definition: shared.definition,
      ...(source === undefined ? {} : { source: sourceIds.get(source.path) }),
      specification: first.specification,
      instances: selected.map(({ instance }) => ({
        name: instance,
        bindings: bindings
          .filter((binding) => binding.instance === instance)
          .map((binding) => ({
            external: binding.external,
            target: binding.target,
            location: location(binding.location, sourceIds),
          })),
      })),
    };
  });
  const declarationsByName = new Map(
    checked.documents.flatMap(({ computations }) => computations).map((item) => [item.name, item]),
  );
  const validation = new Map(
    checked.computationInputValidation.map((item) => [item.name, item.status]),
  );
  const computations = checked.selected.computations.map((runtime) => {
    const authored = declarationsByName.get(runtime.name)!;
    return {
      name: authored.name,
      inputs: authored.inputs.map(({ name, optional, type }) => ({ name, optional, type })),
      result: authored.result,
      location: location(authored.location, sourceIds),
      ...(runtime.inputs === undefined
        ? {}
        : { runtimeInputs: runtime.inputs.map(({ name }) => name) }),
      inputValidation: validation.get(runtime.name) ?? "not-claimed",
    };
  });
  return {
    version: 1,
    checked: true,
    sources,
    declarations,
    concepts,
    ...(checked.documents.every(
      ({ concreteTypes, bindings: declared }) =>
        concreteTypes.length === 0 && declared.length === 0,
    )
      ? {}
      : {
          types: {
            concreteTypes: checked.documents.flatMap(({ concreteTypes }) =>
              concreteTypes.map(({ name, location: at }) => ({
                name,
                location: location(at, sourceIds),
              })),
            ),
            bindings: bindings.map((binding) => ({
              instance: binding.instance,
              external: binding.external,
              target: binding.target,
              location: location(binding.location, sourceIds),
            })),
          },
        }),
    computations,
  };
}

/**
 * Build canonical manifest V1. Config-generated callers pass the one checked model for the exact
 * assembly; assembly-only callers receive an explicit unchecked design block rather than a false
 * authored-design claim.
 */
export function applicationManifest(
  assemblyOrFacts:
    | Assembly<Record<string, new (...args: never[]) => object>>
    | ApplicationAssemblyFacts,
  authored?: { checked: CheckedAuthoredDesignModel; paths: ManifestSourcePaths },
): ApplicationManifestV1 {
  const isFacts = "application" in assemblyOrFacts;
  const facts = isFacts ? assemblyOrFacts : applicationAssemblyFacts(assemblyOrFacts);
  const selectedAuthored =
    authored ?? (isFacts ? undefined : configuredAuthoredDesign.get(assemblyOrFacts));
  const body: Omit<ApplicationManifestV1, "digest"> = {
    format: "sync-engine.application-manifest",
    version: 1,
    generator: GENERATOR_IDENTITY,
    ...facts,
    design:
      selectedAuthored === undefined
        ? {
            version: 1,
            checked: false,
            sources: [],
            declarations: [],
            concepts: [],
            computations: [],
          }
        : checkedDesign(facts, selectedAuthored.checked, selectedAuthored.paths),
  };
  return canonicalValue({
    ...body,
    digest: canonicalDigest(body),
  }) as unknown as ApplicationManifestV1;
}

export function renderApplicationManifest(manifest: ApplicationManifestV1): string {
  return canonicalJson(manifest);
}
