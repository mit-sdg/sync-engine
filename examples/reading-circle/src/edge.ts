import { createGateway, createHttpHandler } from "@mit-sdg/sync-engine/boundary";
import type { ReadingCircleWire } from "../generated/wire.ts";
import { assembleReadingCircle, type ReadingCircleOverrides } from "./assembly.ts";

export function buildReadingCircle(instances: ReadingCircleOverrides = {}) {
  const application = assembleReadingCircle(instances);
  const gateway = createGateway<ReadingCircleWire>({ application });
  return { application, gateway };
}

export function buildReadingCircleHttp(instances: ReadingCircleOverrides = {}) {
  const { application, gateway } = buildReadingCircle(instances);
  const handler = createHttpHandler({ gateway, basePath: "/api" });
  return { application, gateway, handler };
}
