import { createLocalClient } from "@mit-sdg/sync-engine/client";
import type { OperationsRoomWire } from "../generated/wire.ts";
import { buildOperationsRoom } from "./edge.ts";

const { gateway } = buildOperationsRoom();
const operations = createLocalClient<OperationsRoomWire>({ invoker: gateway });

const created = await operations.rooms.create({ name: "Checkout latency", host: "Mara" });
if ("error" in created) throw new Error(String(created.error));
const gathering = created.gathering;

const joined = await operations.rooms.join({ gathering, member: "Lin" });
if ("error" in joined) throw new Error(String(joined.error));

const chosen = await operations.rooms.choose({
  gathering,
  item: "rollback-build-842",
});
if ("error" in chosen) throw new Error(String(chosen.error));

const contribution = await operations.rooms.contribute({
  gathering,
  member: "Lin",
  text: "Latency is falling after rollback.",
});
if ("error" in contribution) throw new Error(String(contribution.error));

const rejected = await operations.rooms.contribute({
  gathering,
  member: "Unknown",
  text: "I should not be admitted.",
});
if (!("error" in rejected) || rejected.error !== "MEMBERS_ONLY") {
  throw new Error("A nonmember contribution was not rejected.");
}

const result = await operations.rooms.get({ gathering });
if ("error" in result) throw new Error(String(result.error));
console.log(JSON.stringify({ dashboard: result.dashboard, rejected: rejected.error }, null, 2));
