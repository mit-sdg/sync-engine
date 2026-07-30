import type { WireProjectionFacts } from "@engine/boundary/gateway/transport-binding";
import type { WireContractsIR } from "@engine/boundary/wire/wire-contracts";

/** Identifies the package that owns one generated wire projection. */
export interface ProjectionProvenance {
  readonly name: string;
  readonly version: string;
}

/** Rendering choices owned by core rather than a projection package. */
export interface ProjectionRenderOptions {
  readonly appWideErrorName?: string;
}

/** A named contract derived from the canonical logical wire. */
export interface WireProjectionResult {
  readonly name: string;
  readonly wire: WireContractsIR;
  readonly render?: ProjectionRenderOptions;
}

/** Extends generated wire output without coupling core to a transport package. */
export interface WireProjection {
  readonly provenance: ProjectionProvenance;
  project(facts: WireProjectionFacts): WireProjectionResult;
}

export interface PlannedWireProjection extends WireProjectionResult {
  readonly provenance: ProjectionProvenance;
}
