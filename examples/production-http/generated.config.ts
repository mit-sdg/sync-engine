import { assembleProductionHttp } from "./src/assembly.ts";
import { productionHttpFloor } from "./src/edge.ts";
import { httpWire } from "@mit-sdg/sync-engine-http/tooling";

export default {
  assemble: assembleProductionHttp,
  title: "Production HTTP",
  wireName: "ProductionHttpWire",
  projections: [httpWire({ policy: productionHttpFloor, name: "ProductionHttpWireHttp" })],
};
