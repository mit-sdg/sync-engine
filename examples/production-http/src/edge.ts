import {
  createGateway,
  createHttpHandler,
  httpFloor,
  productionHttpProfile as defineProductionHttpProfile,
} from "@mit-sdg/sync-engine/boundary";
import type { ProductionHttpWire } from "../generated/wire.ts";
import {
  assembleProductionHttp,
  productionExecutionLimits,
  type ProductionHttpOverrides,
} from "./assembly.ts";

export const productionHttpProfile = defineProductionHttpProfile({
  origin: "https://production-http.test",
  basePath: "/api",
});

export const productionHttpFloor = httpFloor({
  origin: "https://production-http.test",
  basePath: "/api",
  credential: {
    name: "session",
    input: "session",
    issue: {
      path: "/sessions/start",
      output: "session",
      expires: "expiresAt",
    },
    clear: ["/sessions/end"],
  },
});

const correlation = {
  resolve: (request: Request) => request.headers.get("X-Request-Id") ?? undefined,
  responseHeader: "X-Request-Id",
};

export function buildProductionHttp(instances: ProductionHttpOverrides = {}) {
  const application = assembleProductionHttp(instances);
  const gateway = createGateway<ProductionHttpWire>({
    application,
    executionLimits: productionExecutionLimits,
  });
  const profileHandler = createHttpHandler({
    application,
    gateway,
    profile: productionHttpProfile,
    correlation,
  });
  const floorHandler = createHttpHandler({
    application,
    gateway,
    floor: productionHttpFloor,
    correlation,
  });
  return { application, floorHandler, gateway, profileHandler };
}
