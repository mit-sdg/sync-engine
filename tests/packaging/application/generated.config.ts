import { assembleOperationsRoom } from "./src/assembly.ts";

export default {
  assemble: assembleOperationsRoom,
  title: "Operations room",
  design: {
    version: 1,
    documents: [
      new URL("./design/types.md", import.meta.url),
      new URL("./design/operations-room.md", import.meta.url),
    ],
  },
};
