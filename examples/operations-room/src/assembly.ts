/** Assemble the operations room with selectable reaction packs and policy. */
import { assemble, type ImplementationOverrides } from "@mit-sdg/sync-engine/assembly";
import * as Contributions from "./compositions/Contributions.ts";
import * as MitigationAlerts from "./compositions/MitigationAlerts.ts";
import * as MitigationDiscussion from "./compositions/MitigationDiscussion.ts";
import * as Room from "./compositions/Room.ts";
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
      Room: { spec: Room.spec, ...Room.compositions, formers: Room.formers },
      MitigationDiscussion: {
        spec: MitigationDiscussion.spec,
        ...(discussion ? MitigationDiscussion.compositions : {}),
      },
      MitigationAlerts: {
        spec: MitigationAlerts.spec,
        ...(alerts ? MitigationAlerts.compositions : {}),
      },
      Contributions: {
        spec: Contributions.spec,
        ...Contributions.compositions.Contributions[policy],
        views: Contributions.views[policy],
      },
    },
  });
}
