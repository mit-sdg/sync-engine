import { assembleOperationsRoom } from "./src/assembly.ts";

export default {
  assemble: assembleOperationsRoom,
  title: "Operations room",
  vocabulary: { module: new URL("./src/vocabulary.ts", import.meta.url) },
  design: {
    version: 1,
    vocabulary: new URL("./design/vocabulary.md", import.meta.url),
    documents: [
      new URL("./design/compositions/Room.md", import.meta.url),
      new URL("./design/compositions/MitigationDiscussion.md", import.meta.url),
      new URL("./design/compositions/MitigationAlerts.md", import.meta.url),
      new URL("./design/compositions/Contributions.md", import.meta.url),
    ],
  },
};
