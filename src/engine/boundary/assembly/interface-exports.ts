import { $vars } from "@engine/reactions/authoring/vars";
import { declarationsOf } from "@engine/reactions/authoring/partitions";
import { brand, hasBrand } from "@engine/reads/brands";
import { walkValueTree } from "@engine/reads/value-tree";
import { ordinal } from "@engine/utils/ordinal";
import { setOwn } from "@engine/utils/own-property";
import { routeClaimsOverlap } from "../protocol/route-path.ts";
import {
  installInterfaceDeclarationIdentity,
  isInterfaceDefinition,
  type AssembledInterfaceDeclaration,
  type AssembledInterfaceDefinition,
  type InterfaceDefinition,
} from "../protocol/interface-definition.ts";
import type { EndpointDef, EndpointRouteContext } from "./assemble.ts";

// The endpoint brand lives here so the export walk and the endpoint
// constructors in assemble.ts share one definition without a cycle.
const EndpointBrand: unique symbol = Symbol("EndpointBrand");

export function brandEndpointDef(def: EndpointDef): EndpointDef {
  brand(def, EndpointBrand);
  return def;
}

export function isEndpointDef(value: unknown): value is EndpointDef {
  return hasBrand(value, EndpointBrand);
}

export interface CollectedInterfaceExports {
  readonly declarations: Record<string, AssembledInterfaceDeclaration>;
  readonly definitions: readonly {
    readonly identity: string;
    readonly definition: InterfaceDefinition;
  }[];
  canonicalName(value: object): string | undefined;
}

/**
 * The one walk over a module's flat interface exports: each export gains its
 * canonical identity, one value has one name, and a named interface may only
 * select canonical top-level exports. `assemble` runs it while registering an
 * application; `bindInterfaceExports` runs it for declarations checked
 * against an already-running system.
 */
export function collectInterfaceExports(
  site: string,
  exports: Readonly<Record<string, unknown>>,
): CollectedInterfaceExports {
  const declarations: Record<string, AssembledInterfaceDeclaration> = {};
  const definitions: Array<{ identity: string; definition: InterfaceDefinition }> = [];
  const canonicalInterfaceName = new WeakMap<object, string>();

  for (const [identity, value] of Object.entries(exports)) {
    if (value === null || (typeof value !== "object" && typeof value !== "function")) {
      throw new TypeError(
        `${site}: interface export ${JSON.stringify(identity)} must be a declaration or named interface.`,
      );
    }
    const object = value as object;
    const previous = canonicalInterfaceName.get(object);
    if (previous !== undefined) {
      throw new Error(
        `${site}: the same interface value is exported as both ${JSON.stringify(previous)} and ${JSON.stringify(identity)}; one value has one canonical identity.`,
      );
    }
    canonicalInterfaceName.set(object, identity);
    if (isInterfaceDefinition(value)) {
      definitions.push({ identity, definition: value });
      continue;
    }
    installInterfaceDeclarationIdentity(value as object, identity);
    setOwn(declarations, identity, {
      identity,
      value: value as AssembledInterfaceDeclaration["value"],
      kind: isEndpointDef(value) ? "endpoint" : "declaration",
    });
  }

  for (const { identity, definition } of definitions) {
    for (const [member, value] of Object.entries(definition.members)) {
      const canonical = declarations[member];
      if (canonical === undefined || canonical.value !== value) {
        const exported = canonicalInterfaceName.get(value as object);
        const detail =
          exported === undefined
            ? "is not a canonical top-level interface export"
            : `is canonically exported as ${JSON.stringify(exported)}`;
        throw new Error(
          `${site}: interface ${JSON.stringify(identity)} member ${JSON.stringify(member)} ${detail}.`,
        );
      }
    }
  }

  return {
    declarations,
    definitions,
    canonicalName: (value) => canonicalInterfaceName.get(value),
  };
}

/** One endpoint of a bound interface, with its opening answer when it has the rendered shape. */
export interface BoundInterfaceEndpoint {
  readonly identity: string;
  readonly path: string;
  readonly match?: "prefix";
  /** The one renderer invocation the endpoint responds with, when extractable. */
  readonly root?: Readonly<Record<string, unknown>>;
  /** Why no root could be extracted, when it could not. */
  readonly rootRefusal?: string;
}

/** Structurally an `InterfaceBinding`, extended with each endpoint's route and root. */
export interface BoundInterfaceExports {
  readonly identity: string;
  readonly members: readonly AssembledInterfaceDeclaration[];
  readonly dependencies: Readonly<Record<string, readonly AssembledInterfaceDeclaration[]>>;
  readonly declarations: Readonly<Record<string, AssembledInterfaceDeclaration>>;
  readonly endpoints: readonly BoundInterfaceEndpoint[];
}

export interface InterfaceExportBindings {
  readonly declarations: Readonly<Record<string, AssembledInterfaceDeclaration>>;
  readonly definitions: readonly AssembledInterfaceDefinition[];
  binding(definition: InterfaceDefinition): BoundInterfaceExports;
}

function isRendererDeclarationNode(node: unknown): node is { identity: string } {
  if (typeof node !== "object" || node === null) return false;
  const candidate = node as { format?: unknown; identity?: unknown };
  return candidate.format === "sync-engine.renderer" && typeof candidate.identity === "string";
}

function extractRoot(
  identity: string,
  declared: unknown,
): { root?: Readonly<Record<string, unknown>>; rootRefusal?: string } {
  const invocations: Record<string, unknown>[] = [];
  walkValueTree(declared, (node) => {
    if (typeof node !== "object" || node === null || !Object.hasOwn(node, "$renderer")) {
      return undefined;
    }
    invocations.push(node as Record<string, unknown>);
    return false;
  });
  if (invocations.length === 0) {
    return { rootRefusal: `endpoint ${JSON.stringify(identity)} responds with no renderer.` };
  }
  if (invocations.length > 1) {
    return {
      rootRefusal: `endpoint ${JSON.stringify(identity)} responds with more than one renderer invocation.`,
    };
  }
  const found = invocations[0];
  const root: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(found)) {
    if (name === "requestId" && typeof value === "symbol") continue;
    if (typeof value === "symbol") {
      return {
        rootRefusal:
          `endpoint ${JSON.stringify(identity)} passes boundary input ${JSON.stringify(name)} ` +
          "into its rendered answer; a bound interface opens only literal rendered endpoints.",
      };
    }
    setOwn(root, name, value);
  }
  return { root: Object.freeze(root) };
}

export interface EvaluatedEndpoint extends BoundInterfaceEndpoint {
  /** The renderer identities the endpoint's declared reaction reaches. */
  readonly dependencies: readonly string[];
}

/**
 * Evaluate one endpoint declaration without registering it: its route, the
 * renderer identities it reaches, and — when it has the literal rendered
 * shape — the one root invocation it responds with.
 */
export function evaluateEndpoint(identity: string, value: EndpointDef): EvaluatedEndpoint {
  const routeContext: EndpointRouteContext | undefined =
    value.match === "prefix" ? Object.freeze({ path: Symbol("path") }) : undefined;
  const declared = declarationsOf(value.reaction($vars, routeContext));
  const dependencies = new Set<string>();
  walkValueTree(declared, (node) => {
    if (!isRendererDeclarationNode(node)) return undefined;
    dependencies.add(node.identity);
    return undefined;
  });
  return {
    identity,
    path: value.path,
    ...(value.match === undefined ? {} : { match: value.match }),
    ...extractRoot(identity, declared),
    dependencies: Object.freeze([...dependencies].sort(ordinal)),
  };
}

/**
 * Bind a module's flat interface exports without assembling an application:
 * the same canonical naming, membership, dependency-closure, and route
 * checks `assemble` performs, producing per-definition bindings a rendering
 * compiler can validate. Used to check a proposed interface against a system
 * that is already running.
 */
export function bindInterfaceExports(
  exports: Readonly<Record<string, unknown>>,
): InterfaceExportBindings {
  const site = "bindInterfaceExports";
  const collected = collectInterfaceExports(site, exports);
  const declarations = Object.freeze({ ...collected.declarations });

  const endpointsByIdentity = new Map<string, EvaluatedEndpoint>();
  for (const declaration of Object.values(declarations)) {
    if (declaration.kind !== "endpoint") continue;
    const evaluated = evaluateEndpoint(declaration.identity, declaration.value as EndpointDef);
    for (const dependency of evaluated.dependencies) {
      if (declarations[dependency] === undefined) {
        throw new Error(
          `${site}: endpoint ${JSON.stringify(declaration.identity)} reaches renderer ${JSON.stringify(dependency)} outside the complete interface exports.`,
        );
      }
    }
    endpointsByIdentity.set(declaration.identity, evaluated);
  }

  const endpoints = [...endpointsByIdentity.values()];
  for (let left = 0; left < endpoints.length; left += 1) {
    for (let right = left + 1; right < endpoints.length; right += 1) {
      const first = endpoints[left];
      const second = endpoints[right];
      if (first.path === second.path && first.match === second.match) continue;
      if (routeClaimsOverlap(first, second)) {
        throw new Error(
          `${site}: endpoint route ${JSON.stringify(first.path)} from ${JSON.stringify(first.identity)} overlaps ` +
            `${second.match === "prefix" ? "prefix" : "exact path"} ${JSON.stringify(second.path)} from ${JSON.stringify(second.identity)}.`,
        );
      }
    }
  }

  const definitions: readonly AssembledInterfaceDefinition[] = Object.freeze(
    collected.definitions.map(({ identity, definition }) =>
      Object.freeze({
        identity,
        definition,
        members: Object.freeze(Object.keys(definition.members).sort(ordinal)),
        dependencies: Object.freeze(
          Object.fromEntries(
            Object.keys(definition.members)
              .sort(ordinal)
              .map((member) => [
                member,
                Object.freeze([...(endpointsByIdentity.get(member)?.dependencies ?? [])]),
              ]),
          ),
        ),
      }),
    ),
  );

  return Object.freeze({
    declarations,
    definitions,
    binding(definition: InterfaceDefinition): BoundInterfaceExports {
      const selected = definitions.find((candidate) => candidate.definition === definition);
      if (selected === undefined) {
        throw new Error(`${site}: interface must be a named export of the bound module.`);
      }
      const member = (identity: string): AssembledInterfaceDeclaration => declarations[identity]!;
      return Object.freeze({
        identity: selected.identity,
        members: Object.freeze(selected.members.map(member)),
        dependencies: Object.freeze(
          Object.fromEntries(
            Object.entries(selected.dependencies).map(([name, identities]) => [
              name,
              Object.freeze(identities.map(member)),
            ]),
          ),
        ),
        declarations,
        endpoints: Object.freeze(
          selected.members
            .filter((name) => endpointsByIdentity.has(name))
            .map((name) => {
              const { dependencies: _dependencies, ...endpoint } = endpointsByIdentity.get(name)!;
              return Object.freeze(endpoint);
            }),
        ),
      });
    },
  });
}
