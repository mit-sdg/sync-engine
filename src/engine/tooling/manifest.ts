import type { Assembly } from "@engine/boundary/assembly/assembly-facade";
import { assemblyBehind } from "@engine/boundary/assembly/assembly-registry";
import type { InputContractDecl } from "@engine/boundary/protocol/endpoints";
import { wireContracts } from "@engine/boundary/wire/wire-contracts";
import type { WireContractsIR } from "@engine/boundary/wire/wire-contracts";
import type { AppIR, ConceptInventoryIR, FormerIR, ViewIR } from "@engine/reads/ir";
import type { LocalBehaviorReview } from "@engine/reads/local-review";
import { foldFormerNode } from "@engine/reads/schema";
import { canonicalDigest, canonicalJson, canonicalValue } from "@engine/utils/canonical-json";
import type { ApplicationDiagnostic } from "./diagnostics.ts";
import { applicationDiagnostics } from "./diagnostics.ts";

export interface ManifestEndpointV2 {
  name: string;
  path: string;
  reactions: string[];
  input: InputContractDecl;
  validators: { input: boolean; output: boolean };
}

export interface ApplicationManifestV2 {
  format: "sync-engine.application-manifest";
  version: 2;
  digest: string;
  application: AppIR;
  concepts: ConceptInventoryIR[];
  endpoints: ManifestEndpointV2[];
  inputContracts: Record<string, InputContractDecl>;
  wire: WireContractsIR;
  diagnostics: ApplicationDiagnostic[];
  localBehavior: LocalBehaviorReview;
}

function ordinal(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function sortByName<T extends { name: string }>(values: readonly T[]): T[] {
  return [...values].sort((left, right) => ordinal(left.name, right.name));
}

function stableViews(views: readonly ViewIR[]): ViewIR[] {
  const byName = new Map(views.map((view) => [view.name, view]));
  const emitted = new Set<string>();
  const visiting = new Set<string>();
  const result: ViewIR[] = [];
  const visit = (view: ViewIR) => {
    if (emitted.has(view.name) || visiting.has(view.name)) return;
    visiting.add(view.name);
    const dependencies = new Set<string>();
    for (const block of view.alternatives) {
      for (const op of block) {
        if ("view" in op && typeof op.view === "string") dependencies.add(op.view);
      }
    }
    for (const name of [...dependencies].sort(ordinal)) {
      const dependency = byName.get(name);
      if (dependency !== undefined) visit(dependency);
    }
    visiting.delete(view.name);
    emitted.add(view.name);
    result.push(view);
  };
  for (const view of sortByName(views)) visit(view);
  return result;
}

function stableFormers(formers: readonly FormerIR[]): FormerIR[] {
  const byName = new Map(formers.map((former) => [former.name, former]));
  const emitted = new Set<string>();
  const visiting = new Set<string>();
  const result: FormerIR[] = [];
  const visit = (former: FormerIR) => {
    if (emitted.has(former.name) || visiting.has(former.name)) return;
    visiting.add(former.name);
    const dependencies = new Set<string>();
    foldFormerNode(former.body, {
      node: (node) => {
        if (node.node === "former") dependencies.add(node.former);
      },
      splice: ({ fragment }) => dependencies.add(fragment),
    });
    for (const name of [...dependencies].sort(ordinal)) {
      const dependency = byName.get(name);
      if (dependency !== undefined) visit(dependency);
    }
    visiting.delete(former.name);
    emitted.add(former.name);
    result.push(former);
  };
  for (const former of sortByName(formers)) visit(former);
  return result;
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
    actions: sortByName(concept.actions).map((action) => ({
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
 * Snapshot one assembly's static design and explicit local review. Retained runtime state and
 * uninterpreted concept State sections are excluded.
 */
export function applicationManifest(
  assembly: Assembly<Record<string, new (...args: never[]) => object>>,
): ApplicationManifestV2 {
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
  const body: Omit<ApplicationManifestV2, "digest"> = {
    format: "sync-engine.application-manifest",
    version: 2,
    application,
    concepts,
    endpoints,
    inputContracts: assembled.contracts,
    wire,
    diagnostics: applicationDiagnostics(
      application,
      assembled.endpoints,
      wire,
      assembled.localBehavior,
    ),
    localBehavior: assembled.localBehavior,
  };
  const manifest: ApplicationManifestV2 = { ...body, digest: canonicalDigest(body) };
  return canonicalValue(manifest) as unknown as ApplicationManifestV2;
}

export function renderApplicationManifest(manifest: ApplicationManifestV2): string {
  return canonicalJson(manifest);
}
