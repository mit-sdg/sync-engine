/**
 * Concept/action name-derivation helpers for the engine and tooling.
 *
 * These functions extract human-readable names from concept instances and
 * instrumented actions so the engine and tooling can produce stable,
 * descriptive identifiers without duplicating the derivation logic.
 *
 * These helpers import no application concepts or boundaries.
 */
import type { ActionPattern, InstrumentedAction } from "./types.ts";
import type { ConceptInventoryIR } from "../reads/ir.ts";
import { contractOf } from "./outcomes.ts";
import { conceptMetadataOf } from "./concept-metadata.ts";
import { queryPromiseOf } from "../reads/query-contracts.ts";

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

/**
 * Stable node identifier for a concept-action pair.
 * e.g. "Authenticating.authenticate"
 */
export function actionNodeId(p: ActionPattern): string {
  return `${conceptNameOf(p.concept)}.${actionNameOf(p.action)}`;
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
  const authored = concept.constructor as { purpose?: unknown; principle?: unknown };
  const metadata = conceptMetadataOf(concept);
  const purpose = metadata?.purpose ?? authored.purpose;
  const principle = metadata?.principle ?? authored.principle;
  if (typeof purpose === "string") inventory.purpose = purpose;
  if (typeof principle === "string") inventory.principle = principle;

  for (const name of Object.getOwnPropertyNames(Object.getPrototypeOf(concept))) {
    if (name === "constructor") continue;
    const member = (concept as Record<string, unknown>)[name];
    if (typeof member !== "function") continue;
    const roles = rolesOf(member as (...args: never[]) => unknown);
    if (name.startsWith("_")) {
      inventory.queries.push({
        name,
        ...(roles !== undefined ? { roles } : {}),
        ...(queryPromiseOf(concept, name) !== undefined
          ? { returns: queryPromiseOf(concept, name) }
          : {}),
      });
      continue;
    }
    const refusals = contractOf(concept, name)?.refusals;
    inventory.actions.push({
      name,
      ...(roles !== undefined ? { roles } : {}),
      ...(refusals !== undefined ? { refusals: [...refusals] } : {}),
    });
  }
  return inventory;
}
