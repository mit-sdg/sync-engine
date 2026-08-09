import { createGateway } from "@mit-sdg/sync-engine/boundary";
import { createHttpHandler, httpPolicy } from "@mit-sdg/sync-engine-http/server";
import type { ProductionHttpWire } from "../generated/wire.ts";
import {
  assembleProductionHttp,
  productionExecutionLimits,
  type ProductionHttpOverrides,
} from "./assembly.ts";

const publicErrors = {
  NAME_TAKEN: "CONFLICT",
  UNKNOWN_SESSION: "UNAUTHORIZED",
} as const;

export const productionHttpPolicy = httpPolicy({
  origin: "https://production-http.test",
  basePath: "/api",
  publicErrors,
});

export const productionCookiePolicy = httpPolicy({
  origin: "https://production-http.test",
  basePath: "/api",
  publicErrors,
  cookie: {
    name: "session",
    input: "session",
    issue: {
      path: "/sessions/start",
      value: "session",
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
  const plainHandler = createHttpHandler({
    application,
    gateway,
    policy: productionHttpPolicy,
    correlation,
  });
  const cookieHandler = createHttpHandler({
    application,
    gateway,
    policy: productionCookiePolicy,
    correlation,
  });
  return { application, cookieHandler, gateway, plainHandler };
}
