import { registerConcept } from "@mit-sdg/sync-engine/assembly";
import {
  InvalidCredentials,
  InvalidUsername,
  UsernameTaken,
  WeakPassword,
} from "./authenticating.shared.ts";
import spec from "./spec.md" with { type: "text" };
//#floor memory
import { AuthenticatingMemoryConcept } from "./authenticating.memory.ts";
//#endfloor
//#floor mongo
import type { Db } from "mongodb";
import { AuthenticatingMongoConcept } from "./authenticating.mongo.ts";
//#endfloor

//#class memory AuthenticatingMemoryConcept
//#class mongo AuthenticatingMongoConcept
export const authenticating = registerConcept({
  class: AuthenticatingMemoryConcept, // selected-class
  spec,
  refusals: {
    INVALID_USERNAME: InvalidUsername,
    WEAK_PASSWORD: WeakPassword,
    USERNAME_TAKEN: UsernameTaken,
    INVALID_CREDENTIALS: InvalidCredentials,
  },
  floors: {
    //#floor memory
    memory: (_context: {}) => new AuthenticatingMemoryConcept(),
    //#endfloor
    //#floor mongo
    mongo: ({ db }: { db: Db }) => new AuthenticatingMongoConcept(db),
    //#endfloor
  },
});
