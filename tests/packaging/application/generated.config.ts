import { assembleOperationsRoom } from "./src/assembly.ts";
import mitigatingSpec from "./src/concepts/mitigating/spec.md" with { type: "text" };
import roomingSpec from "./src/concepts/rooming/spec.md" with { type: "text" };

export default {
  assemble: assembleOperationsRoom,
  title: "Operations room",
  design: {
    version: 1,
    vocabulary: new URL("./design/vocabulary.md", import.meta.url),
    documents: [new URL("./design/operations-room.md", import.meta.url)],
  },
  vocabulary: { module: new URL("./src/vocabulary.ts", import.meta.url) },
  authoredDesignAdapters: {
    conceptSources: () => [
      {
        instance: "Mitigating",
        url: new URL("./src/concepts/mitigating/spec.md", import.meta.url),
        content: mitigatingSpec,
      },
      {
        instance: "Rooming",
        url: new URL("./src/concepts/rooming/spec.md", import.meta.url),
        content: roomingSpec,
      },
    ],
    resolveComputationInputs: () => [],
  },
};
