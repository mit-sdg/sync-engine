import { assembleMultiInstanceContract, multiInstanceHttpPolicy } from "./src/contract.ts";
import { httpWire } from "@mit-sdg/sync-engine-http/tooling";

export default {
  assemble: assembleMultiInstanceContract,
  title: "Multi-instance compatibility",
  directory: new URL("./src/generated/", import.meta.url),
  wireName: "MultiInstanceWire",
  design: {
    version: 1,
    documents: [
      new URL("./design/types.md", import.meta.url),
      new URL("./design/application.md", import.meta.url),
    ],
  },
  conceptSet: {
    module: new URL("./src/contract.ts", import.meta.url),
    export: "multiInstanceConcepts",
  },
  projections: [httpWire({ policy: multiInstanceHttpPolicy, name: "MultiInstanceHttpWire" })],
};
