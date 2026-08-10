import { conceptSet } from "@mit-sdg/sync-engine/assembly";
import { authenticating } from "./concepts/authenticating/registry.ts";
import { commenting } from "./concepts/commenting/registry.ts";
import { posting } from "./concepts/posting/registry.ts";
import { sessioning } from "./concepts/sessioning/registry.ts";

export const messageBoardConcepts = conceptSet({
  Authenticating: authenticating,
  Commenting: commenting,
  Posting: posting,
  Sessioning: sessioning,
});

export const { concepts, vocabulary } = messageBoardConcepts;
