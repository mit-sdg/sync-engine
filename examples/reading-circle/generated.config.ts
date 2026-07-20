import { assembleReadingCircle } from "./src/assembly.ts";

export default {
  assemble: assembleReadingCircle,
  directory: new URL("./generated/", import.meta.url),
  specification: "reading-circle.md",
  title: "Reading circle",
  wire: "wire.ts",
  wireBanner: "// Generated from the reading-circle assembly. Do not edit.",
  wireName: "ReadingCircleWire",
  wireVocabulary: { from: "../src/concept-set.ts", export: "vocabulary" },
};
