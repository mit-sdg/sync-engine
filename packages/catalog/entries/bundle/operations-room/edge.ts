import { createGateway } from "@mit-sdg/sync-engine/boundary";
import type { OperationsRoomWire } from "../generated/wire.ts";
import { assembleOperationsRoom } from "./assembly.ts";

export function buildOperationsRoom() {
  const application = assembleOperationsRoom();
  const gateway = createGateway<OperationsRoomWire>({ application });
  return { application, gateway };
}
