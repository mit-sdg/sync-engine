import { conceptSet } from "@mit-sdg/sync-engine/assembly";
import { authenticating } from "./concepts/Authenticating.registry.ts";
import { commenting } from "./concepts/Commenting.registry.ts";
import { posting } from "./concepts/Posting.registry.ts";
import { sessioning } from "./concepts/Sessioning.registry.ts";

export const applicationConceptSet = conceptSet({
  Authenticating: authenticating,
  Commenting: commenting,
  Posting: posting,
  Sessioning: sessioning,
});

export const { concepts } = applicationConceptSet;
