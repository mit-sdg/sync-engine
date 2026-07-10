/**
 * Concept/action name-derivation helpers for the engine and tooling.
 *
 * These functions extract human-readable names from concept instances and
 * instrumented actions so the engine — and any future tooling like a sync-graph
 * viewer — can produce stable, descriptive identifiers without duplicating the
 * derivation logic.
 *
 * They are deliberately app-agnostic: zero imports from `@concepts` or `@sdk`.
 */
import type { ActionPattern, InstrumentedAction } from "./types.ts";

/**
 * Extract the human-readable concept name from a concept instance.
 * Strips the "Concept" suffix if present (matching the convention
 * that concept classes are named e.g. `AuthenticatingConcept`).
 */
export function conceptNameOf(concept: object): string {
  const n = concept.constructor?.name ?? "Unknown";
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
