import { registerConcept } from "@mit-sdg/sync-engine/assembly";
import { AlertNotFound } from "./errors.ts";
import spec from "./spec.md" with { type: "text" };
import { AlertingConcept } from "./alerting.ts";

export const alerting = registerConcept({
  class: AlertingConcept,
  spec,
  queries: { _openFor: "many" },
  refusals: {
    ALERT_NOT_FOUND: { error: AlertNotFound, on: ["acknowledge"] },
  },
  floors: {
    deterministic: ({ identities }: { identities: { Alerting: () => string } }) =>
      new AlertingConcept(identities.Alerting),
  },
});
