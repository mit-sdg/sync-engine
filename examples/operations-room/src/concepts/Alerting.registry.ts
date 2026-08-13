import { registerConcept } from "@mit-sdg/sync-engine/assembly";
import { AlertingConcept, AlertNotFound } from "./Alerting.ts";
import spec from "@design/concepts/Alerting.md" with { type: "text" };

export const alerting = registerConcept({
  class: AlertingConcept,
  spec,
  refusals: { ALERT_NOT_FOUND: AlertNotFound },
  floors: {
    deterministic: ({ identities }: { identities: Record<string, () => string> }, name: string) =>
      new AlertingConcept(identities[name]),
  },
});
