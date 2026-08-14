/**
 * Full end-to-end story through a local gateway.
 *
 * The application is built across these modules:
 *   src/concepts.ts                    — concept set and implementations
 *   src/compositions/Room.ts             — room endpoints
 *   src/compositions/Mitigation*.ts      — selectable reaction packs
 *   src/compositions/Contributions.ts    — endpoints and selectable policy views
 *   src/compositions/Room.ts             — room endpoints and owned read models
 *   src/assembly.ts                       — option selection and installation
 *   src/edge.ts                           — local gateway construction
 */
import { createLocalClient } from "@mit-sdg/sync-engine/client";
import { deterministicImplementations } from "./concepts.ts";
import { buildOperationsRoom } from "./edge.ts";
import type { OperationsRoomWire } from "../generated/wire.ts";

export async function runScenario() {
  const { gateway } = buildOperationsRoom({
    ...deterministicImplementations({
      Alerting: ["alert-mara", "alert-lin"],
      Discussing: ["discussion-1", "response-1"],
      Gathering: ["checkout-latency", "member-mara", "member-lin"],
      Selecting: ["selection-1"],
    }),
  });
  const operations = createLocalClient<OperationsRoomWire>({ invoker: gateway });

  const created = await operations.rooms.create({ name: "Checkout latency", host: "Mara" });
  if ("error" in created) throw new Error(String(created.error));
  const room = created.room;
  await operations.rooms.join({ room, responder: "Lin" });
  const duplicate = await operations.rooms.join({ room, responder: "Lin" });
  await operations.rooms["choose-mitigation"]({ room, mitigation: "rollback-build-842" });
  await operations.rooms.contribute({
    room,
    responder: "Lin",
    text: "Latency is falling after rollback.",
  });
  const result = await operations.rooms.get({ room });

  if ("error" in result) throw new Error(String(result.error));
  if (!("error" in duplicate)) throw new Error("Expected a duplicate-membership refusal.");
  return { dashboard: result.dashboard, duplicate: duplicate.error };
}

if (import.meta.main) console.log(JSON.stringify(await runScenario(), null, 2));
