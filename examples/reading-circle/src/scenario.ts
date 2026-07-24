/**
 * Full end-to-end story through a local gateway.
 *
 * The application is built in:
 *   src/concept-set.ts         — vocabulary and implementations
 *   src/composition/reading-circle.ts — reactions, views, formers, endpoints
 *   src/assembly.ts            — the assemble() call
 *   src/edge.ts                — gateway and HTTP wiring
 */
import { createLocalClient } from "@mit-sdg/sync-engine/client";
import { identities } from "../../support/identities.ts";
import { deterministicImplementations } from "./concept-set.ts";
import { buildReadingCircle } from "./edge.ts";
import type { ReadingCircleWire } from "../generated/wire.ts";

export async function runScenario() {
  const { gateway } = buildReadingCircle({
    ...deterministicImplementations({
      identities: {
        Alerting: identities(),
        Discussing: identities("discussion-1", "response-1"),
        Gathering: identities("after-dinner", "mara-membership", "lin-membership"),
        Selecting: identities("selection-1"),
      },
    }),
  });
  const circles = createLocalClient<ReadingCircleWire>({ invoker: gateway });

  const created = await circles.circles.create({ name: "After Dinner", host: "Mara" });
  if ("error" in created) throw new Error(String(created.error));
  const circle = created.circle;
  await circles.circles.join({ circle, member: "Lin" });
  const duplicate = await circles.circles.join({ circle, member: "Lin" });
  await circles.circles.choose({ circle, reading: "The Dispossessed" });
  await circles.circles.respond({
    circle,
    reading: "The Dispossessed",
    member: "Lin",
    text: "The two worlds make each other's assumptions visible.",
  });
  const denied = await circles.circles.respond({
    circle,
    reading: "The Dispossessed",
    member: "Niko",
    text: "May I join the conversation?",
  });
  const result = await circles.circles.page({ circle });

  if ("error" in result) throw new Error(String(result.error));
  if (!("error" in duplicate) || !("error" in denied)) throw new Error("Expected refusals.");
  return { page: result.page, duplicate: duplicate.error, denied: denied.error };
}

if (import.meta.main) console.log(JSON.stringify(await runScenario(), null, 2));
