import { assemble, type ImplementationOverrides } from "@mit-sdg/sync-engine/assembly";
import { contributionEndpoints } from "./composition/contributions.ts";
import * as hostMayContribute from "./composition/host-may-contribute.ts";
import {
  SelectedMitigationAlertsResponders,
  SelectedMitigationOpensDiscussion,
} from "./composition/packs.ts";
import * as respondersMayContribute from "./composition/responders-may-contribute.ts";
import {
  ChooseMitigation,
  CreateRoom,
  currentMitigation,
  GetRoom,
  JoinRoom,
  responderRoster,
  responseStats,
  requiredCurrentMitigation,
  roomDashboard,
  roomSummary,
} from "./composition/room.ts";
import { operationsRoomConcepts, vocabulary } from "./concept-set.ts";

const room = {
  responderRoster,
  roomSummary,
  requiredCurrentMitigation,
  currentMitigation,
  responseStats,
  roomDashboard,
  CreateRoom,
  JoinRoom,
  ChooseMitigation,
  GetRoom,
};

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
      room,
      discussion: discussion ? { SelectedMitigationOpensDiscussion } : {},
      alerts: alerts ? { SelectedMitigationAlertsResponders } : {},
      policy,
      contributions: contributionEndpoints({
        denied: policy.deniedContribution,
        mayContribute: policy.responderMayContribute,
        mayNotContribute: policy.responderMayNotContribute,
      }),
    },
  });
}

export type OperationsRoomApp = ReturnType<typeof assembleOperationsRoom>;
