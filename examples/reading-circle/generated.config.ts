import { assembleReadingCircle } from "./src/assembly.ts";

export default {
  assemble: assembleReadingCircle,
  title: "Reading circle",
  vocabulary: { module: new URL("./src/vocabulary.ts", import.meta.url) },
};
