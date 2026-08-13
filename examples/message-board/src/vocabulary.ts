import spec from "@design/vocabulary.md" with { type: "text" };
import { conceptSet } from "@mit-sdg/sync-engine/assembly";

export { spec };
import { authenticating } from "./concepts/Authenticating.registry.ts";
import { commenting } from "./concepts/Commenting.registry.ts";
import { posting } from "./concepts/Posting.registry.ts";
import { sessioning } from "./concepts/Sessioning.registry.ts";

export const messageBoardConcepts = conceptSet({
  Authenticating: authenticating,
  Commenting: commenting,
  Posting: posting,
  Sessioning: sessioning,
});

export const { concepts, vocabulary } = messageBoardConcepts;
