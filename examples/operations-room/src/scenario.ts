/**
 * Full end-to-end story through a local gateway.
 *
 * The application is built across these modules:
 *   src/concept-set.ts                — vocabulary and implementations
 *   src/composition/room.ts           — formers (dashboard, mitigation status)
 *   src/composition/packs.ts          — optional reaction packs
 *   src/composition/contributions.ts  — parameterized contribution endpoints
 *   src/composition/host-may-contribute.ts   — policy: host-only contributions
 *   src/composition/responders-may-contribute.ts — policy: any-responder contributions
 *   src/assembly.ts                   — the assemble() call with selectable options
 *   src/edge.ts                       — gateway and HTTP wiring
 */
import { createLocalClient } from "@mit-sdg/sync-engine/client";
import { identities } from "../../support/identities.ts";
import { deterministicImplementations } from "./concept-set.ts";
import { buildOperationsRoom } from "./edge.ts";
import type { OperationsRoomWire } from "../generated/wire.ts";

export async function runScenario() {
  const { gateway } = buildOperationsRoom({
    ...deterministicImplementations({
      identities: {
        Alerting: identities("alert-mara", "alert-lin"),
        Discussing: identities("discussion-1", "response-1"),
        Gathering: identities("checkout-latency", "member-mara", "member-lin"),
        Selecting: identities("selection-1"),
      },
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
