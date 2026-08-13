import { assembleApplication } from "./src/assembly.ts";

export default {
  assemble: assembleApplication,
  title: "Application",
  vocabulary: { module: new URL("./src/vocabulary.ts", import.meta.url) },
};
