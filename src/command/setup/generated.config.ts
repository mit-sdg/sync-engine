import { assembleApplication } from "./src/assembly.ts";

export default {
  assemble: assembleApplication,
  title: "Application",
  design: { version: 1, documents: [] },
  vocabulary: { module: new URL("./src/vocabulary.ts", import.meta.url) },
};
