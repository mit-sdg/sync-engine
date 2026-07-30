import { assembleMultiInstanceContract, multiInstanceHttpProfile } from "./src/contract.ts";
import { httpWire } from "@mit-sdg/sync-engine-http/tooling";

export default {
  assemble: assembleMultiInstanceContract,
  title: "Multi-instance compatibility",
  directory: new URL("./src/generated/", import.meta.url),
  wireName: "MultiInstanceWire",
  vocabulary: { module: new URL("./src/contract.ts", import.meta.url) },
  projections: [httpWire({ policy: multiInstanceHttpProfile, name: "MultiInstanceHttpWire" })],
};
