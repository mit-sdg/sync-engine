import { conceptSet } from "@mit-sdg/sync-engine/assembly";
import { alerting } from "../../concepts/alerting/registry.ts";
import { discussing } from "../../concepts/discussing/registry.ts";
import { gathering } from "../../concepts/gathering/registry.ts";
import { selecting } from "../../concepts/selecting/registry.ts";
import type { DeterministicFloorContext } from "../../support/deterministic-floor.ts";

export const operationsRoomConcepts = conceptSet({
  Gathering: gathering,
  Selecting: selecting,
  Discussing: discussing,
  Alerting: alerting,
});

export const { concepts, vocabulary } = operationsRoomConcepts;

export function deterministicImplementations(context: DeterministicFloorContext) {
  return operationsRoomConcepts.implementations("deterministic", context);
}
