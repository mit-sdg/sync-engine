import { assembleProductionHttp } from "./src/assembly.ts";
import { productionHttpFloor } from "./src/edge.ts";

export default {
  assemble: assembleProductionHttp,
  title: "Production HTTP",
  wireName: "ProductionHttpWire",
  httpFloor: productionHttpFloor,
};
