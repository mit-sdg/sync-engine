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
