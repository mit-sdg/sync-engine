import { createGateway } from "@mit-sdg/sync-engine/boundary";
import { assembleOperationsRoom, type OperationsRoomOverrides } from "./assembly.ts";
import type { OperationsRoomWire } from "../generated/wire.ts";

export function buildOperationsRoom(instances: OperationsRoomOverrides = {}) {
  const application = assembleOperationsRoom({ instances });
  const gateway = createGateway<OperationsRoomWire>({ application });
  return { application, gateway };
}
