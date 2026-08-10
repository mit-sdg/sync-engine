import { httpWire } from "@mit-sdg/sync-engine-http/tooling";
import { assembleMessageBoard } from "./src/assembly.ts";
import { messageBoardPolicy } from "./src/edge.ts";

export default {
  assemble: assembleMessageBoard,
  title: "Message board",
  wireName: "MessageBoardWire",
  projections: [httpWire({ policy: messageBoardPolicy, name: "MessageBoardWireHttp" })],
};
