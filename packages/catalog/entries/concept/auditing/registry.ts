import { registerConcept } from "@mit-sdg/sync-engine/assembly";
import { EntryEventConflict, InvalidEntryAction, InvalidEntryDetail } from "./auditing.shared.ts";
import spec from "./spec.md" with { type: "text" };
//#floor memory
import { AuditingMemoryConcept } from "./auditing.memory.ts";
//#endfloor
//#floor mongo
import type { Db } from "mongodb";
import { AuditingMongoConcept } from "./auditing.mongo.ts";
//#endfloor

//#class memory AuditingMemoryConcept
//#class mongo AuditingMongoConcept
export const auditing = registerConcept({
  class: AuditingMemoryConcept, // selected-class
  spec,
  refusals: {
    INVALID_ENTRY_ACTION: InvalidEntryAction,
    INVALID_ENTRY_DETAIL: InvalidEntryDetail,
    ENTRY_EVENT_CONFLICT: EntryEventConflict,
  },
  floors: {
    //#floor memory
    memory: (_context: {}) => new AuditingMemoryConcept(),
    //#endfloor
    //#floor mongo
    mongo: ({ db }: { db: Db }) => new AuditingMongoConcept(db),
    //#endfloor
  },
});
