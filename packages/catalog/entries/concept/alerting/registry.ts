import { registerConcept } from "@mit-sdg/sync-engine/assembly";
import { AlertCauseConflict, AlertNotOpenForRecipient } from "./alerting.shared.ts";
import spec from "./spec.md" with { type: "text" };
//#floor memory
import { AlertingMemoryConcept } from "./alerting.memory.ts";
//#endfloor

//#class memory AlertingMemoryConcept
export const alerting = registerConcept({
  class: AlertingMemoryConcept, // selected-class
  spec,
  refusals: {
    ALERT_CAUSE_CONFLICT: AlertCauseConflict,
    ALERT_NOT_OPEN_FOR_RECIPIENT: AlertNotOpenForRecipient,
  },
  floors: {
    //#floor memory
    memory: (_context: {}) => new AlertingMemoryConcept(),
    //#endfloor
  },
});
