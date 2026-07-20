import { registerConcept } from "@mit-sdg/sync-engine/assembly";
import type { DeterministicFloorContext } from "../../support/deterministic-floor.ts";
import { AlertNotFound } from "./errors.ts";
import spec from "./spec.md" with { type: "text" };
import { AlertingConcept } from "./alerting.ts";

export const alerting = registerConcept({
  class: AlertingConcept,
  spec,
  refusals: {
    ALERT_NOT_FOUND: { error: AlertNotFound, on: ["acknowledge"] },
  },
  floors: {
    deterministic: ({ identities }: DeterministicFloorContext) =>
      new AlertingConcept(identities.Alerting),
  },
});
