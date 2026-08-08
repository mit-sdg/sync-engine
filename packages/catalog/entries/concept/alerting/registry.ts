import { registerConcept } from "@mit-sdg/sync-engine/assembly";
import { AlertingConcept, AlertNotFound } from "./alerting.ts";
import spec from "./spec.md" with { type: "text" };

export const alerting = registerConcept({
  class: AlertingConcept,
  spec,
  refusals: { ALERT_NOT_FOUND: AlertNotFound },
});
