import { assembleReadingCircle } from "./src/assembly.ts";

export default {
  assemble: assembleReadingCircle,
  title: "Reading circle",
  design: {
    version: 1,
    documents: [
      new URL("./design/types.md", import.meta.url),
      new URL("./design/compositions/ReadingCircle.md", import.meta.url),
    ],
  },
};
