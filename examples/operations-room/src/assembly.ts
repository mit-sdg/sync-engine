/** Assemble the operations room with selectable reaction packs and policy. */
import { assemble, type ImplementationOverrides } from "@mit-sdg/sync-engine/assembly";
import { compositionFor as contributionComposition } from "./compositions/Contributions.ts";
import { composition as mitigationAlertsComposition } from "./compositions/MitigationAlerts.ts";
import { composition as mitigationDiscussionComposition } from "./compositions/MitigationDiscussion.ts";
import { composition as roomComposition } from "./compositions/Room.ts";
import { operationsRoomConcepts, vocabulary } from "./vocabulary.ts";

export type OperationsRoomOverrides = ImplementationOverrides<typeof vocabulary>;

export interface OperationsRoomOptions {
  alerts?: boolean;
  contributions?: "responders" | "host";
  discussion?: boolean;
  instances?: OperationsRoomOverrides;
}

export function assembleOperationsRoom({
  alerts = true,
  contributions = "responders",
  discussion = true,
  instances = {},
}: OperationsRoomOptions = {}) {
  const policy = contributions === "responders" ? "Responders" : "Host";

  return assemble({
    vocabulary,
    instances: { ...operationsRoomConcepts.implementations(), ...instances },
    composition: {
      Room: roomComposition,
      ...(discussion ? { MitigationDiscussion: mitigationDiscussionComposition } : {}),
      ...(alerts ? { MitigationAlerts: mitigationAlertsComposition } : {}),
      Contributions: contributionComposition(policy),
    },
  });
}
