import { assembleOperationsRoom } from "./src/assembly.ts";

export default {
  assemble: assembleOperationsRoom,
  title: "Operations room",
  design: { version: 1, documents: [] },
  vocabulary: { module: new URL("./src/vocabulary.ts", import.meta.url) },
};
