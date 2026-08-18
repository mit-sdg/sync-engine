import { assemble } from "@mit-sdg/sync-engine/assembly";
import { applicationConceptSet } from "./concepts.ts";

import { endpoint, receive, respond } from "@mit-sdg/sync-engine/boundary";

const Added = endpoint("/added", () => receive().then(respond({ ok: true })));

export default {
  assemble: () =>
    assemble({
      conceptSet: applicationConceptSet,
      instances: applicationConceptSet.implementations(),
      composition: { Added },
    }),
  title: "Added diff fixture",
  conceptSet: { module: new URL("./concepts.ts", import.meta.url) },
  design: { version: 1, documents: [new URL("./added.md", import.meta.url)] },
};
