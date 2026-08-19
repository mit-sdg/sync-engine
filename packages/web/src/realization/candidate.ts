import { bindInterfaceExports, type InterfaceDefinition } from "@mit-sdg/sync-engine/boundary";
import type { Assembly } from "@mit-sdg/sync-engine/assembly";
import type { FetchClaim } from "@mit-sdg/sync-engine-http/realization";
import { compileHtml } from "@mit-sdg/sync-engine-rendering/compiled";
import type { RendererInvocation } from "@mit-sdg/sync-engine-rendering/language";
import {
  assertHeadStylesheets,
  assertImmediatesBound,
  claimsForEndpoints,
  headHtmlFor,
  readerFor,
  renderedRealization,
  type ImmediateBindings,
  type RenderedSurface,
  type WebHead,
  type WebRealization,
} from "./realization.ts";
import { interfaceRevision } from "./revision.ts";

type AnyAssembly = Assembly<Record<string, new (...args: never[]) => object>>;

/** Candidate previews are served under this reserved path prefix. */
export const candidatePathPrefix = "/candidate/";

/** The durable, portable record of one assembled candidate. */
export interface CandidateManifest {
  readonly format: "sync-engine.web-candidate";
  readonly version: 1;
  readonly interface: string;
  readonly revision: string;
  /** The display name the record and spine project for this candidate. */
  readonly name: string | null;
  /** Who asked for the candidate — requester attribution for its record. */
  readonly requester: string | null;
  /** The accepted interface revision the candidate was assembled against, when known. */
  readonly base: string | null;
  readonly endpoints: readonly {
    readonly identity: string;
    readonly path: string;
    readonly match?: "prefix";
  }[];
  readonly renderers: readonly string[];
  readonly immediates: readonly string[];
  /** The authored source the candidate was assembled from, retained whole. */
  readonly source: string | null;
}

/** An immutable, validated interface revision with its live preview realization. */
export interface WebCandidate {
  readonly system: AnyAssembly;
  readonly interface: string;
  readonly revision: string;
  /** The preview mount prefix, derived from the revision. */
  readonly path: string;
  /** The preview realization's claims, all under the candidate path. */
  readonly claims: readonly FetchClaim[];
  /** The live preview: ordinary holders over the same system, at the candidate path. */
  readonly realization: WebRealization;
  readonly manifest: CandidateManifest;
  /** The surface promotion swaps in at the accepted paths. */
  promotedSurface(): RenderedSurface;
}

/**
 * Assemble one interface-only candidate against a running system: validate
 * the complete claims the interface makes — canonical exports, renderer
 * closure, routes, immediates, head — and construct its realization without
 * serving anything. Returns the immutable candidate or throws a named
 * refusal; a refused assembly serves nothing and records nothing.
 */
export async function assembleCandidate(options: {
  system: AnyAssembly;
  /** The candidate module's flat interface exports. */
  exports: Readonly<Record<string, unknown>>;
  interface: InterfaceDefinition;
  head?: WebHead;
  immediates?: ImmediateBindings;
  /** The authored source, retained whole in the manifest. */
  source?: string;
  /** The display name the candidate's record projects. */
  name?: string;
  /** Who asked for the candidate. */
  requester?: string;
  /** The accepted interface revision this candidate revises. */
  base?: string;
}): Promise<WebCandidate> {
  const site = "Web.assembleCandidate";
  const bound = bindInterfaceExports(options.exports);
  const binding = bound.binding(options.interface);

  const roots = new Map<string, RendererInvocation>();
  for (const endpoint of binding.endpoints) {
    if (endpoint.rootRefusal !== undefined) {
      throw new TypeError(`${site}: ${endpoint.rootRefusal}`);
    }
    if (endpoint.match === "prefix") {
      throw new TypeError(
        `${site}: endpoint ${JSON.stringify(endpoint.identity)} claims a route prefix; ` +
          "a candidate serves exact rendered endpoints.",
      );
    }
    if (endpoint.path.startsWith(candidatePathPrefix)) {
      throw new TypeError(
        `${site}: endpoint ${JSON.stringify(endpoint.identity)} claims ${JSON.stringify(endpoint.path)} ` +
          `inside the reserved ${JSON.stringify(candidatePathPrefix)} prefix.`,
      );
    }
    roots.set(endpoint.path, endpoint.root as unknown as RendererInvocation);
  }
  if (roots.size === 0) {
    throw new TypeError(
      `${site}: interface ${JSON.stringify(binding.identity)} has no rendered endpoint.`,
    );
  }

  const rendering = compileHtml(binding);
  const immediateSource = assertImmediatesBound(site, rendering, options.immediates);
  assertHeadStylesheets(site, options.head);
  const revision = await interfaceRevision(binding);
  const path = `${candidatePathPrefix}${revision.slice(0, 12)}`;

  const reader = readerFor(options.system);
  const headHtml = headHtmlFor(options.head, rendering, reader);

  const surfaceAt = (servedPath: (path: string) => string): RenderedSurface => ({
    interface: binding.identity,
    rendering,
    claims: claimsForEndpoints(
      binding.endpoints.map(({ identity, path: endpointPath }) => ({
        identity,
        path: endpointPath,
      })),
      servedPath,
    ),
    async open(requested) {
      for (const [endpointPath, root] of roots) {
        if (servedPath(endpointPath) === requested) return root;
      }
      return undefined;
    },
    headHtml,
    immediateSource,
    revision: () => Promise.resolve(revision),
  });

  const manifest: CandidateManifest = Object.freeze({
    format: "sync-engine.web-candidate",
    version: 1,
    interface: binding.identity,
    revision,
    name: options.name ?? null,
    requester: options.requester ?? null,
    base: options.base ?? null,
    endpoints: Object.freeze(
      binding.endpoints.map(({ identity, path: endpointPath, match }) =>
        Object.freeze({ identity, path: endpointPath, ...(match === undefined ? {} : { match }) }),
      ),
    ),
    renderers: rendering.renderers,
    immediates: rendering.immediates,
    source: options.source ?? null,
  });

  const preview = surfaceAt((endpointPath) => `${path}${endpointPath}`);
  const realization = renderedRealization({ system: options.system, surface: preview });

  return Object.freeze({
    system: options.system,
    interface: binding.identity,
    revision,
    path,
    claims: preview.claims,
    realization,
    manifest,
    promotedSurface: () => surfaceAt((endpointPath) => endpointPath),
  });
}

/** The durable record of one authorized promotion: which revision the host applies. */
export interface CandidateSelection {
  /** The accepted interface revision the selection was ruled over. */
  readonly base: string;
  /** The candidate revision the selection makes current. */
  readonly selected: string;
}

export type SelectionApplication =
  /** The assembled source already carries the selected revision; the selection is spent. */
  | { readonly kind: "spent" }
  /** The assembled source matches the selection's base; apply the selected candidate. */
  | { readonly kind: "apply" }
  /** The source moved on; serve the source and surface the stale selection for re-ruling. */
  | { readonly kind: "stale"; readonly reason: string };

/**
 * The startup precedence for a recorded selection, stated completely: a
 * selection is never silently applied over newer source and never silently
 * dropped.
 */
export function applySelection(options: {
  sourceRevision: string;
  selection: CandidateSelection;
}): SelectionApplication {
  const { sourceRevision, selection } = options;
  if (sourceRevision === selection.selected) return { kind: "spent" };
  if (sourceRevision === selection.base) return { kind: "apply" };
  return {
    kind: "stale",
    reason:
      `the assembled source revision ${JSON.stringify(sourceRevision)} matches neither the ` +
      `selection's base ${JSON.stringify(selection.base)} nor its selected candidate ` +
      `${JSON.stringify(selection.selected)}; the source superseded the selection.`,
  };
}
