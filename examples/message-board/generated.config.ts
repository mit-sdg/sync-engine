import { httpWire } from "@mit-sdg/sync-engine-http/tooling";
import { assembleMessageBoard } from "./src/assembly.ts";
import { messageBoardPolicy } from "./src/edge.ts";

export default {
  assemble: assembleMessageBoard,
  title: "Message board",
  wireName: "MessageBoardWire",
  vocabulary: { module: new URL("./src/vocabulary.ts", import.meta.url) },
  design: {
    version: 1,
    vocabulary: new URL("./design/vocabulary.md", import.meta.url),
    documents: [
      new URL("./design/compositions/Sessions.md", import.meta.url),
      new URL("./design/compositions/Board.md", import.meta.url),
    ],
  },
  projections: [httpWire({ policy: messageBoardPolicy, name: "MessageBoardWireHttp" })],
};
