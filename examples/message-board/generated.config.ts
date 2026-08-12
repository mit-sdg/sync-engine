import { httpWire } from "@mit-sdg/sync-engine-http/tooling";
import { assembleMessageBoard } from "./src/assembly.ts";
import { messageBoardPolicy } from "./src/edge.ts";

export default {
  assemble: assembleMessageBoard,
  title: "Message board",
  wireName: "MessageBoardWire",
  vocabulary: { module: new URL("./src/vocabulary.ts", import.meta.url) },
  projections: [httpWire({ policy: messageBoardPolicy, name: "MessageBoardWireHttp" })],
};
