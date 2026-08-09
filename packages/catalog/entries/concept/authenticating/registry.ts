import { registerConcept } from "@mit-sdg/sync-engine/assembly";
import {
  AuthenticatingConcept,
  IdentifierAlreadyRegistered,
  InvalidCredentials,
  InvalidIdentifier,
  InvalidSecret,
} from "./authenticating.ts";
import spec from "./spec.md" with { type: "text" };

export const authenticating = registerConcept({
  class: AuthenticatingConcept,
  spec,
  refusals: {
    IDENTIFIER_ALREADY_REGISTERED: IdentifierAlreadyRegistered,
    INVALID_CREDENTIALS: InvalidCredentials,
    INVALID_IDENTIFIER: InvalidIdentifier,
    INVALID_SECRET: InvalidSecret,
  },
});
