import type { Assembly } from "@engine/boundary/assembly/assembly-facade";
import { assemblyBehind } from "@engine/boundary/assembly/assembly-registry";
import type { InputContractDecl } from "@engine/boundary/protocol/endpoints";
import { wireContracts } from "@engine/boundary/wire/wire-contracts";
import type { WireContractsIR } from "@engine/boundary/wire/wire-contracts";
import type { AppIR, ConceptInventoryIR, FormerIR, ViewIR } from "@engine/reads/ir";
import { foldFormerNode } from "@engine/reads/schema";
import { canonicalDigest, canonicalJson, canonicalValue } from "@engine/utils/canonical-json";
import { ordinal } from "@engine/utils/ordinal";
import { GENERATOR_IDENTITY, type GeneratorIdentity } from "@engine/utils/package-version";
import type { ApplicationDiagnostic } from "./diagnostics.ts";
import { applicationDiagnostics } from "./diagnostics.ts";

export interface ManifestEndpointV3 {
  name: string;
  path: string;
  reactions: string[];
  input: InputContractDecl;
  validators: { input: boolean; output: boolean };
}

export interface ApplicationManifestV3 {
  format: "sync-engine.application-manifest";
  version: 3;
  generator: GeneratorIdentity;
  digest: string;
  application: AppIR;
  concepts: ConceptInventoryIR[];
  endpoints: ManifestEndpointV3[];
  inputContracts: Record<string, InputContractDecl>;
  wire: WireContractsIR;
  diagnostics: ApplicationDiagnostic[];
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
  return stableByDependency(views, (view) => {
    const dependencies = new Set<string>();
    for (const block of view.alternatives) {
      for (const op of block) {
        if ("view" in op && typeof op.view === "string") dependencies.add(op.view);
      }
    }
    return dependencies;
  });
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
        ...(action.roles === undefined ? {} : { roles: [...action.roles].sort(ordinal) }),
        ...(action.refusals === undefined ? {} : { refusals: [...action.refusals].sort(ordinal) }),
      })),
    queries: sortByName(concept.queries).map((query) => ({
      ...query,
      ...(query.roles === undefined ? {} : { roles: [...query.roles].sort(ordinal) }),
    })),
  }));
}

/**
 * Snapshot one assembly's static design. Retained runtime state and uninterpreted concept State
 * sections are excluded.
 */
export function applicationManifest(
  assembly: Assembly<Record<string, new (...args: never[]) => object>>,
): ApplicationManifestV3 {
  const assembled = assemblyBehind(assembly);
  const application = stableApp(assembled.engine.exportReactions());
  const concepts = stableConcepts(assembled.engine.exportConcepts());
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
      },
    }))
    .sort((left, right) => ordinal(`${left.path}\0${left.name}`, `${right.path}\0${right.name}`));
  const body: Omit<ApplicationManifestV3, "digest"> = {
    format: "sync-engine.application-manifest",
    version: 3,
    generator: GENERATOR_IDENTITY,
    application,
    concepts,
    endpoints,
    inputContracts: assembled.contracts,
    wire,
    diagnostics: applicationDiagnostics(application, assembled.endpoints, wire),
  };
  const manifest: ApplicationManifestV3 = { ...body, digest: canonicalDigest(body) };
  return canonicalValue(manifest) as unknown as ApplicationManifestV3;
}

export function renderApplicationManifest(manifest: ApplicationManifestV3): string {
  return canonicalJson(manifest);
}
