/**
 * Registers the domain concepts (Alerting, Discussing, Gathering, Selecting)
 * for the operations room application.
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
import { alerting } from "./concepts/Alerting.registry.ts";
import { discussing } from "./concepts/Discussing.registry.ts";
import { gathering } from "./concepts/Gathering.registry.ts";
import { selecting } from "./concepts/Selecting.registry.ts";
import { identitiesFor } from "./identities.ts";

export const operationsRoomConcepts = conceptSet({
  Gathering: gathering,
  Selecting: selecting,
  Discussing: discussing,
  Alerting: alerting,
});

export const { concepts, vocabulary } = operationsRoomConcepts;

/** Build the concept set with one fixed id sequence per concept name. */
export function deterministicImplementations(
  sequences: Readonly<Record<string, readonly string[]>>,
) {
  return operationsRoomConcepts.implementations("deterministic", {
    identities: identitiesFor(sequences, Object.keys(concepts)),
  });
}
