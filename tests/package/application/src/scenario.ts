import { createLocalClient } from "@mit-sdg/sync-engine/client";
import type { OperationsRoomWire } from "../generated/wire.ts";
import { buildOperationsRoom } from "./edge.ts";

const { gateway } = buildOperationsRoom();
const operations = createLocalClient<OperationsRoomWire>({ invoker: gateway });

const opened = await operations.rooms.open({ name: "Checkout latency" });
if ("error" in opened) throw new Error(String(opened.error));
const result = await operations.rooms.get({ room: opened.room });
if ("error" in result) throw new Error(String(result.error));
if (result.dashboard.mitigation !== "investigate") {
  throw new Error("The room did not receive its initial mitigation.");
}
console.log(JSON.stringify(result.dashboard));
