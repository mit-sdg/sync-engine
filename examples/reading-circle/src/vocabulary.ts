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
import { discussing } from "./concepts/Discussing.registry.ts";
import { gathering } from "./concepts/Gathering.registry.ts";
import { selecting } from "./concepts/Selecting.registry.ts";
import { identitiesFor } from "./identities.ts";

export const readingCircleConcepts = conceptSet({
  Gathering: gathering,
  Selecting: selecting,
  Discussing: discussing,
});

export const { concepts, vocabulary } = readingCircleConcepts;

/** Build the concept set with one fixed id sequence per concept name. */
export function deterministicImplementations(
  sequences: Readonly<Record<string, readonly string[]>>,
) {
  return readingCircleConcepts.implementations("deterministic", {
    identities: identitiesFor(sequences, Object.keys(concepts)),
  });
}
