import { registerConcept } from "@mit-sdg/sync-engine/assembly";
import {
  InvitationAlreadyPending,
  InvitationNotPendingForInvitee,
  InvitationNotPendingForInviter,
} from "./inviting.shared.ts";
import spec from "./spec.md" with { type: "text" };
//#floor memory
import { InvitingMemoryConcept } from "./inviting.memory.ts";
//#endfloor
//#floor mongo
import type { Db } from "mongodb";
import { InvitingMongoConcept } from "./inviting.mongo.ts";
//#endfloor

//#class memory InvitingMemoryConcept
//#class mongo InvitingMongoConcept
export const inviting = registerConcept({
  class: InvitingMemoryConcept, // selected-class
  spec,
  refusals: {
    INVITATION_ALREADY_PENDING: InvitationAlreadyPending,
    INVITATION_NOT_PENDING_FOR_INVITEE: InvitationNotPendingForInvitee,
    INVITATION_NOT_PENDING_FOR_INVITER: InvitationNotPendingForInviter,
  },
  floors: {
    //#floor memory
    memory: (_context: {}) => new InvitingMemoryConcept(),
    //#endfloor
    //#floor mongo
    mongo: ({ db }: { db: Db }) => new InvitingMongoConcept(db),
    //#endfloor
  },
});
