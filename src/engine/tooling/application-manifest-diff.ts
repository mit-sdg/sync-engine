import type { InputContractDecl } from "@engine/boundary/protocol/endpoints";
import { canonicallyEqual } from "@engine/utils/canonical-json";
import { ordinal } from "@engine/utils/ordinal";
import type { ApplicationManifestV1, ManifestEndpointV1 } from "./manifest.ts";

/** An endpoint's stable manifest identity for compatibility reporting. */
export interface ManifestEndpointReference {
  readonly name: string;
  readonly path: string;
}

/** One refusal code declared by a named action in the manifest inventory. */
export interface ManifestRefusalCodeReference {
  readonly concept: string;
  readonly action: string;
  readonly code: string;
}

/** One SSF-owned type declared by a named concept definition. */
export interface ManifestOwnedTypeReference {
  readonly definition: string;
  readonly type: string;
}

/** One compatibility-relevant change directly represented in an application manifest. */
export type ApplicationManifestChange =
  | { readonly kind: "endpoint-added"; readonly endpoint: ManifestEndpointReference }
  | { readonly kind: "endpoint-removed"; readonly endpoint: ManifestEndpointReference }
  | { readonly kind: "input-required-added"; readonly path: string; readonly key: string }
  | { readonly kind: "input-required-removed"; readonly path: string; readonly key: string }
  | {
      readonly kind: "input-default-added";
      readonly path: string;
      readonly key: string;
      readonly value: unknown;
    }
  | {
      readonly kind: "input-default-removed";
      readonly path: string;
      readonly key: string;
      readonly value: unknown;
    }
  | {
      readonly kind: "input-default-changed";
      readonly path: string;
      readonly key: string;
      readonly before: unknown;
      readonly after: unknown;
    }
  | { readonly kind: "refusal-code-added"; readonly refusal: ManifestRefusalCodeReference }
  | { readonly kind: "refusal-code-removed"; readonly refusal: ManifestRefusalCodeReference }
  | { readonly kind: "owned-type-added"; readonly ownedType: ManifestOwnedTypeReference }
  | { readonly kind: "owned-type-removed"; readonly ownedType: ManifestOwnedTypeReference };

/** A plain-data compatibility report suitable for a later machine-readable command format. */
export interface ApplicationManifestDiffReport {
  /** Whether the complete canonical manifests have matching digests. */
  readonly status: "identical" | "changed";
  readonly old: { readonly digest: string };
  readonly current: { readonly digest: string };
  readonly breaking: readonly ApplicationManifestChange[];
  readonly nonBreaking: readonly ApplicationManifestChange[];
}

function compareEndpoint(
  left: ManifestEndpointReference,
  right: ManifestEndpointReference,
): number {
  return ordinal(left.path, right.path) || ordinal(left.name, right.name);
}

function compareRefusal(
  left: ManifestRefusalCodeReference,
  right: ManifestRefusalCodeReference,
): number {
  return (
    ordinal(left.concept, right.concept) ||
    ordinal(left.action, right.action) ||
    ordinal(left.code, right.code)
  );
}

function compareOwnedType(
  left: ManifestOwnedTypeReference,
  right: ManifestOwnedTypeReference,
): number {
  return ordinal(left.definition, right.definition) || ordinal(left.type, right.type);
}

function endpointIdentity(endpoint: ManifestEndpointV1): string {
  return JSON.stringify([endpoint.name, endpoint.path]);
}

function endpointsByIdentity(
  manifest: ApplicationManifestV1,
): Map<string, ManifestEndpointReference> {
  return new Map(
    manifest.endpoints.map((endpoint) => [
      endpointIdentity(endpoint),
      { name: endpoint.name, path: endpoint.path },
    ]),
  );
}

function refusalIdentity(refusal: ManifestRefusalCodeReference): string {
  return JSON.stringify([refusal.concept, refusal.action, refusal.code]);
}

function refusalsByIdentity(
  manifest: ApplicationManifestV1,
): Map<string, ManifestRefusalCodeReference> {
  const result = new Map<string, ManifestRefusalCodeReference>();
  for (const concept of manifest.concepts) {
    for (const action of concept.actions) {
      for (const code of action.refusals ?? []) {
        const refusal = { concept: concept.name, action: action.name, code };
        result.set(refusalIdentity(refusal), refusal);
      }
    }
  }
  return result;
}

function ownedTypeIdentity(ownedType: ManifestOwnedTypeReference): string {
  return JSON.stringify([ownedType.definition, ownedType.type]);
}

function ownedTypesByIdentity(
  manifest: ApplicationManifestV1,
): Map<string, ManifestOwnedTypeReference> {
  const result = new Map<string, ManifestOwnedTypeReference>();
  for (const concept of manifest.design.concepts) {
    for (const type of concept.ownedTypes) {
      const ownedType = { definition: concept.definition, type };
      result.set(ownedTypeIdentity(ownedType), ownedType);
    }
  }
  return result;
}

function contractDefaults(contract: InputContractDecl): Readonly<Record<string, unknown>> {
  return contract.defaults ?? {};
}

function sortedDifference(values: Iterable<string>, excluded: ReadonlySet<string>): string[] {
  return [...values].filter((value) => !excluded.has(value)).sort(ordinal);
}

/**
 * Compare two already-decoded version-1 manifests over the compatibility surface.
 * Callers that receive untrusted JSON must parse it with `parseApplicationManifest` first.
 */
export function diffApplicationManifests(
  oldManifest: ApplicationManifestV1,
  currentManifest: ApplicationManifestV1,
): ApplicationManifestDiffReport {
  const breaking: ApplicationManifestChange[] = [];
  const nonBreaking: ApplicationManifestChange[] = [];

  const oldEndpoints = endpointsByIdentity(oldManifest);
  const currentEndpoints = endpointsByIdentity(currentManifest);
  const oldEndpointPaths = new Set(oldManifest.endpoints.map(({ path }) => path));
  for (const endpoint of [...oldEndpoints.values()].sort(compareEndpoint)) {
    if (!currentEndpoints.has(JSON.stringify([endpoint.name, endpoint.path]))) {
      breaking.push({ kind: "endpoint-removed", endpoint });
    }
  }
  for (const endpoint of [...currentEndpoints.values()].sort(compareEndpoint)) {
    if (oldEndpoints.has(JSON.stringify([endpoint.name, endpoint.path]))) continue;
    const change: ApplicationManifestChange = { kind: "endpoint-added", endpoint };
    if (oldEndpointPaths.has(endpoint.path)) breaking.push(change);
    else nonBreaking.push(change);
  }

  for (const path of Object.keys(oldManifest.inputContracts).sort(ordinal)) {
    if (!Object.hasOwn(currentManifest.inputContracts, path)) continue;
    const oldContract = oldManifest.inputContracts[path]!;
    const currentContract = currentManifest.inputContracts[path]!;
    const oldRequired = new Set(oldContract.required ?? []);
    const currentRequired = new Set(currentContract.required ?? []);
    for (const key of sortedDifference(currentRequired, oldRequired)) {
      breaking.push({ kind: "input-required-added", path, key });
    }
    for (const key of sortedDifference(oldRequired, currentRequired)) {
      nonBreaking.push({ kind: "input-required-removed", path, key });
    }

    const oldDefaults = contractDefaults(oldContract);
    const currentDefaults = contractDefaults(currentContract);
    for (const key of Object.keys(currentDefaults).sort(ordinal)) {
      if (!Object.hasOwn(oldDefaults, key)) {
        breaking.push({ kind: "input-default-added", path, key, value: currentDefaults[key] });
      } else if (!canonicallyEqual(oldDefaults[key], currentDefaults[key])) {
        breaking.push({
          kind: "input-default-changed",
          path,
          key,
          before: oldDefaults[key],
          after: currentDefaults[key],
        });
      }
    }
    for (const key of Object.keys(oldDefaults).sort(ordinal)) {
      if (Object.hasOwn(currentDefaults, key)) continue;
      breaking.push({ kind: "input-default-removed", path, key, value: oldDefaults[key] });
    }
  }

  const oldRefusals = refusalsByIdentity(oldManifest);
  const currentRefusals = refusalsByIdentity(currentManifest);
  for (const refusal of [...oldRefusals.values()].sort(compareRefusal)) {
    if (!currentRefusals.has(refusalIdentity(refusal))) {
      breaking.push({ kind: "refusal-code-removed", refusal });
    }
  }
  for (const refusal of [...currentRefusals.values()].sort(compareRefusal)) {
    if (!oldRefusals.has(refusalIdentity(refusal))) {
      breaking.push({ kind: "refusal-code-added", refusal });
    }
  }

  const oldOwnedTypes = ownedTypesByIdentity(oldManifest);
  const currentOwnedTypes = ownedTypesByIdentity(currentManifest);
  for (const ownedType of [...oldOwnedTypes.values()].sort(compareOwnedType)) {
    if (!currentOwnedTypes.has(ownedTypeIdentity(ownedType))) {
      breaking.push({ kind: "owned-type-removed", ownedType });
    }
  }
  for (const ownedType of [...currentOwnedTypes.values()].sort(compareOwnedType)) {
    if (!oldOwnedTypes.has(ownedTypeIdentity(ownedType))) {
      nonBreaking.push({ kind: "owned-type-added", ownedType });
    }
  }

  return {
    status: oldManifest.digest === currentManifest.digest ? "identical" : "changed",
    old: { digest: oldManifest.digest },
    current: { digest: currentManifest.digest },
    breaking,
    nonBreaking,
  };
}
