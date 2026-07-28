import { createGateway } from "@mit-sdg/sync-engine/boundary";
import type { ReadingCircleWire } from "../generated/wire.ts";
import { assembleReadingCircle, type ReadingCircleOverrides } from "./assembly.ts";

export function buildReadingCircle(instances: ReadingCircleOverrides = {}) {
  const application = assembleReadingCircle(instances);
  const gateway = createGateway<ReadingCircleWire>({ application });
  return { application, gateway };
}
