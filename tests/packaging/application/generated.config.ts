import { assembleOperationsRoom } from "./src/assembly.ts";

export default {
  assemble: assembleOperationsRoom,
  title: "Operations room",
  vocabulary: { module: new URL("./src/vocabulary.ts", import.meta.url) },
};
