import { assembleReadingCircle } from "./src/assembly.ts";

export default {
  assemble: assembleReadingCircle,
  title: "Reading circle",
  vocabulary: { module: new URL("./src/vocabulary.ts", import.meta.url) },
  design: {
    version: 1,
    vocabulary: new URL("./design/vocabulary.md", import.meta.url),
    documents: [new URL("./design/compositions/ReadingCircle.md", import.meta.url)],
  },
};
