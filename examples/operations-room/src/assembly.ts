/** Assemble the operations room with selectable reaction packs and policy. */
import { assemble, type ImplementationOverrides } from "@mit-sdg/sync-engine/assembly";
import { contributionEndpoints } from "./compositions/Contributions.ts";
import * as mitigationAlerts from "./compositions/MitigationAlerts.ts";
import * as mitigationDiscussion from "./compositions/MitigationDiscussion.ts";
import * as room from "./compositions/Room.ts";
import * as roomFormers from "./formers/Room.ts";
import * as hostMayContribute from "./views/HostMayContribute.ts";
import * as respondersMayContribute from "./views/RespondersMayContribute.ts";
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
  const policy = contributions === "responders" ? respondersMayContribute : hostMayContribute;
  const selected = { ...operationsRoomConcepts.implementations(), ...instances };

  return assemble({
    vocabulary,
    instances: selected,
    composition: {
      compositions: {
        room,
        mitigationDiscussion: discussion ? mitigationDiscussion : {},
        mitigationAlerts: alerts ? mitigationAlerts : {},
        contributions: contributionEndpoints({
          denied: policy.deniedContribution,
          mayContribute: policy.responderMayContribute,
          mayNotContribute: policy.responderMayNotContribute,
        }),
      },
      views: { contributionPolicy: policy },
      formers: roomFormers,
    },
  });
}
