import { assemble } from "@mit-sdg/sync-engine/assembly";
import { applicationConceptSet } from "./concepts.ts";

export default {
  assemble: () =>
    assemble({
      conceptSet: applicationConceptSet,
      instances: applicationConceptSet.implementations(),
      composition: {},
    }),
  title: "Empty diff fixture",
  conceptSet: { module: new URL("./concepts.ts", import.meta.url) },
  design: { version: 1, documents: [] },
};
