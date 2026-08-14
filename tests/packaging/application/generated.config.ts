import { assembleOperationsRoom } from "./src/assembly.ts";

export default {
  assemble: assembleOperationsRoom,
  title: "Operations room",
  design: {
    version: 1,
    vocabulary: new URL("./design/vocabulary.md", import.meta.url),
    documents: [new URL("./design/operations-room.md", import.meta.url)],
  },
  vocabulary: { module: new URL("./src/vocabulary.ts", import.meta.url) },
};
