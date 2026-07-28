import { assembleMultiInstanceContract, multiInstanceHttpProfile } from "./src/contract.ts";

export default {
  assemble: assembleMultiInstanceContract,
  title: "Multi-instance compatibility",
  directory: new URL("./src/generated/", import.meta.url),
  wireName: "MultiInstanceWire",
  httpWireName: "MultiInstanceHttpWire",
  vocabulary: { module: new URL("./src/contract.ts", import.meta.url) },
  httpProfile: multiInstanceHttpProfile,
};
