import { registerConcept } from "@mit-sdg/sync-engine/assembly";
import spec from "@design/concepts/Gathering.md" with { type: "text" };
import { GatheringConcept, AlreadyJoined, GatheringNotFound, NotJoined } from "./Gathering.ts";

export const gathering = registerConcept({
  class: GatheringConcept,
  spec,
  refusals: {
    GATHERING_NOT_FOUND: GatheringNotFound,
    ALREADY_JOINED: AlreadyJoined,
    NOT_JOINED: NotJoined,
  },
  floors: {
    deterministic: ({ identities }: { identities: Record<string, () => string> }, name: string) =>
      new GatheringConcept(identities[name]),
  },
});
