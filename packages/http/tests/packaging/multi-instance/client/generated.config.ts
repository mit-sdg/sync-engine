import { assembleMultiInstanceContract, multiInstanceHttpPolicy } from "./src/contract.ts";
import { httpWire } from "@mit-sdg/sync-engine-http/tooling";

export default {
  assemble: assembleMultiInstanceContract,
  title: "Multi-instance compatibility",
  directory: new URL("./src/generated/", import.meta.url),
  wireName: "MultiInstanceWire",
  design: {
    version: 1,
    vocabulary: new URL("./design/vocabulary.md", import.meta.url),
    documents: [new URL("./design/application.md", import.meta.url)],
  },
  vocabulary: { module: new URL("./src/contract.ts", import.meta.url) },
  projections: [httpWire({ policy: multiInstanceHttpPolicy, name: "MultiInstanceHttpWire" })],
};
