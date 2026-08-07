/**
 * Concept/action name-derivation helpers for the engine and tooling.
 *
 * These functions extract human-readable names from concept instances and
 * instrumented actions so the engine and tooling can produce stable,
 * descriptive identifiers without duplicating the derivation logic.
 *
 * These helpers import no application concepts or boundaries.
 */
import type { InstrumentedAction } from "../types.ts";
import type { ConceptInventoryIR } from "@engine/reads/ir";
import { contractOf } from "./outcomes.ts";
import {
  callableConceptMember,
  CONCEPT_MEMBER_ROLES,
  CONCEPT_PROTOCOL,
  conceptMetadataOf,
  conceptProtocolOf,
} from "./concept-metadata.ts";
import { queryPromiseOf } from "@engine/reads/query-contracts";

/**
 * An explicit concept name, stamped on an instance when it was instrumented
 * under a chosen name (the record key in `engine.instrument({ Name: … })`).
 * The name in the design is a naming choice, not a class derivation: it lets a
 * substituted implementation class (for example, a Mongo variant) use the concept's
 * name, and two instances of one class answer to two names.
 */
export const CONCEPT_NAME: unique symbol = Symbol("conceptName");

/**
 * Extract the human-readable concept name from a concept instance: the
 * stamped {@link CONCEPT_NAME} when the instance was instrumented under a
 * chosen name, else the class name with the "Concept" suffix stripped
 * (matching the convention that classes are named e.g. `AuthenticatingConcept`).
 */
export function conceptNameOf(concept: object): string {
  const stamped = (concept as Record<symbol, unknown>)[CONCEPT_NAME];
  if (typeof stamped === "string") return stamped;
  // Read the class through the prototype, not the instance: an instrumented
  // proxy intercepts property gets, and `concept.constructor` through it is
  // the instrumentation wrapper rather than the class.
  const n =
    (Object.getPrototypeOf(concept) as { constructor?: { name?: string } } | null)?.constructor
      ?.name ?? "Unknown";
  return n.endsWith("Concept") ? n.slice(0, -"Concept".length) : n;
}

/**
 * Extract the action name from an instrumented action.
 * Strips the "bound " prefix from bound method names.
 */
export function actionNameOf(action: InstrumentedAction): string {
  const bound = action.action;
  if (!bound) return "UNDEFINED";
  const name = bound.name;
  return name.startsWith("bound ") ? name.slice("bound ".length) : name;
}

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/**
 * Observe a method's input roles from its one destructured parameter —
 * `add({ title, priority })` reads as roles `title, priority`. Conventions
 * honored: a parameter named `_` means the method takes nothing; anything
 * the reader cannot be sure of (nested destructuring, no destructuring at
 * all) returns `undefined`, which the renderer shows as `(…)` rather than
 * guessing.
 */
export function rolesOf(fn: (...args: never[]) => unknown): string[] | undefined {
  const source = String(fn);
  if (/^[^(]*\(\s*_\d*\s*[,)]/.test(source)) return [];
  const destructured = /^[^(]*\(\s*\{([^{}]*)\}/.exec(source);
  if (destructured === null) return undefined;
  const roles: string[] = [];
  const body = destructured[1].trim();
  if (body === "") return roles;
  for (const part of body.split(",")) {
    const role = part.split(/[:=]/)[0].trim();
    if (!IDENTIFIER.test(role)) return undefined;
    roles.push(role);
  }
  return roles;
}

/**
 * Collect the registered information available for one concept instance:
 * its actions (with observed input roles and declared refusal codes), its
 * queries, and — when the class authors them — `static purpose` and
 * `static principle` prose.
 */
export function inventoryOf(concept: object): ConceptInventoryIR {
  const inventory: ConceptInventoryIR = {
    name: conceptNameOf(concept),
    actions: [],
    queries: [],
  };
  const authored = (
    Object.getPrototypeOf(concept) as {
      constructor?: { purpose?: unknown; principle?: unknown };
    } | null
  )?.constructor;
  const metadata = conceptMetadataOf(concept);
  const canonicalRoles = metadata?.[CONCEPT_MEMBER_ROLES];
  const purpose =
    canonicalRoles === undefined ? (metadata?.purpose ?? authored?.purpose) : metadata?.purpose;
  const principle =
    canonicalRoles === undefined
      ? (metadata?.principle ?? authored?.principle)
      : metadata?.principle;
  if (typeof purpose === "string") inventory.purpose = purpose;
  if (typeof principle === "string") inventory.principle = principle;
  if (metadata?.specification !== undefined) inventory.specification = metadata.specification;

  const prototype = Object.getPrototypeOf(concept) as object | null;
  const protocol = metadata?.[CONCEPT_PROTOCOL] ?? conceptProtocolOf(prototype ?? concept);
  for (const name of protocol.actions) {
    const member = callableConceptMember(concept, name);
    if (member === undefined) continue;
    const roles =
      canonicalRoles?.actions[name] ?? (canonicalRoles === undefined ? rolesOf(member) : undefined);
    const refusals = contractOf(concept, name)?.refusals;
    inventory.actions.push({
      name,
      ...(roles !== undefined ? { roles: [...roles] } : {}),
      ...(refusals !== undefined ? { refusals: [...refusals] } : {}),
    });
  }
  for (const name of protocol.queries) {
    const member = callableConceptMember(concept, name);
    if (member === undefined) continue;
    const roles =
      canonicalRoles?.queries[name] ?? (canonicalRoles === undefined ? rolesOf(member) : undefined);
    const promise = queryPromiseOf(concept, name);
    inventory.queries.push({
      name,
      ...(roles !== undefined ? { roles: [...roles] } : {}),
      ...(promise !== undefined ? { returns: promise } : {}),
    });
  }
  return inventory;
}
