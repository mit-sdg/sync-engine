import { registerConcept } from "@mit-sdg/sync-engine/assembly";
import { GatheringConcept, AlreadyJoined, GatheringNotFound, NotJoined } from "./gathering.ts";
import spec from "./spec.md" with { type: "text" };

export const gathering = registerConcept({
  class: GatheringConcept,
  spec,
  queries: {
    _get: "optional",
    _members: "many",
    _membership: "one",
  },
  refusals: {
    GATHERING_NOT_FOUND: { error: GatheringNotFound, on: ["join", "leave"] },
    ALREADY_JOINED: { error: AlreadyJoined, on: ["join"] },
    NOT_JOINED: { error: NotJoined, on: ["leave"] },
  },
  floors: {
    deterministic: ({ identities }: { identities: { Gathering: () => string } }) =>
      new GatheringConcept(identities.Gathering),
  },
});
