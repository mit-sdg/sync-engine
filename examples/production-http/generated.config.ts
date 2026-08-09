import { assembleProductionHttp } from "./src/assembly.ts";
import { productionCookiePolicy } from "./src/edge.ts";
import { httpWire } from "@mit-sdg/sync-engine-http/tooling";

export default {
  assemble: assembleProductionHttp,
  title: "Production HTTP",
  wireName: "ProductionHttpWire",
  projections: [httpWire({ policy: productionCookiePolicy, name: "ProductionHttpWireHttp" })],
};
