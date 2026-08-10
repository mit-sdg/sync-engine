import { registerConcept } from "@mit-sdg/sync-engine/assembly";
import { AlertCauseConflict, AlertNotOpenForRecipient } from "./alerting.shared.ts";
import spec from "./spec.md" with { type: "text" };
//#floor memory
import { AlertingMemoryConcept } from "./alerting.memory.ts";
//#endfloor
//#floor mongo
import type { Db } from "mongodb";
import { AlertingMongoConcept } from "./alerting.mongo.ts";
//#endfloor

//#class memory AlertingMemoryConcept
//#class mongo AlertingMongoConcept
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
    //#floor mongo
    mongo: ({ db }: { db: Db }) => new AlertingMongoConcept({ db }),
    //#endfloor
  },
});
