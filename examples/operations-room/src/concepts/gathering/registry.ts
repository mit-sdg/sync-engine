import { registerConcept } from "@mit-sdg/sync-engine/assembly";
import type { DeterministicFloorContext } from "../../support/deterministic-floor.ts";
import { AlreadyJoined, GatheringNotFound, NotJoined } from "./errors.ts";
import spec from "./spec.md" with { type: "text" };
import { GatheringConcept } from "./gathering.ts";

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
    deterministic: ({ identities }: DeterministicFloorContext) =>
      new GatheringConcept(identities.Gathering),
  },
});
