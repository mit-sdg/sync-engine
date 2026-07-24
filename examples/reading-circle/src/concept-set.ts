/**
 * Registers the domain concepts (Gathering, Selecting, Discussing) for the
 * reading circle application.
 *
 * `conceptSet(registrations)` returns:
 *  - `vocabulary` — concept signatures for assembly introspection and codegen
 *  - `concepts`   — typed shortcuts for composition files
 *  - `implementations(floor, ctx)` — factory for named sets of concrete instances
 *
 * A "floor" is a preconfigured set of concept instances. The `"deterministic"`
 * floor uses fixed IDs so scenario output is stable enough to snapshot.
 */
import { conceptSet } from "@mit-sdg/sync-engine/assembly";
import { discussing } from "../../concepts/discussing/registry.ts";
import { gathering } from "../../concepts/gathering/registry.ts";
import { selecting } from "../../concepts/selecting/registry.ts";
import type { DeterministicFloorContext } from "../../support/deterministic-floor.ts";

export const readingCircleConcepts = conceptSet({
  Gathering: gathering,
  Selecting: selecting,
  Discussing: discussing,
});

export const { concepts, vocabulary } = readingCircleConcepts;

export function deterministicImplementations(context: DeterministicFloorContext) {
  return readingCircleConcepts.implementations("deterministic", context);
}
