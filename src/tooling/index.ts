/** Supported inspection, rendering, and generated-contract tools. */
export { inspectAssembly } from "@engine/tooling/inspection";
export type { ObservedOccurrence } from "@engine/tooling/inspection";
export { applicationDiagnostics, diagnosticsFail } from "@engine/tooling/diagnostics";
export type {
  ApplicationDiagnostic,
  DiagnosticCode,
  DiagnosticSeverity,
} from "@engine/tooling/diagnostics";
export { applicationManifest, renderApplicationManifest } from "@engine/tooling/manifest";
export type { ApplicationManifestV3, ManifestEndpointV3 } from "@engine/tooling/manifest";
export { renderApp, renderReaction } from "@engine/reads/render";
export { wireContracts } from "@engine/boundary/wire/wire-contracts";
export { renderWireTypes } from "@engine/boundary/wire/wire-renderer";
export { renderInputContracts } from "@engine/boundary/protocol/endpoints";
export type { AppIR, ConceptInventoryIR, FormerIR, ReactionIR, ViewIR } from "@engine/reads/ir";
export type {
  WireContractsIR,
  WireEndpoint,
  WireOptions,
} from "@engine/boundary/wire/wire-contracts";
export type { WireRenderOptions } from "@engine/boundary/wire/wire-renderer";
export type { WireType } from "@engine/boundary/wire/wire-types";
export type { GeneratedApplication } from "@engine/tooling/generated-artifacts";
export type {
  PlannedWireProjection,
  ProjectionProvenance,
  ProjectionRenderOptions,
  WireProjection,
  WireProjectionResult,
} from "@engine/tooling/wire-projection";
