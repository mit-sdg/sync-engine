import { assembleOperationsRoom } from "./src/assembly.ts";

export default {
  assemble: assembleOperationsRoom,
  title: "Operations room",
  design: {
    version: 1,
    documents: [
      new URL("./design/types.md", import.meta.url),
      new URL("./design/compositions/Room.md", import.meta.url),
      new URL("./design/compositions/MitigationDiscussion.md", import.meta.url),
      new URL("./design/compositions/MitigationAlerts.md", import.meta.url),
      new URL("./design/compositions/Contributions.md", import.meta.url),
    ],
  },
};
