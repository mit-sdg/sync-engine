import { expect, test } from "vite-plus/test";
import { compositions } from "./incident-room.ts";

const {
  AcknowledgeMitigationAlert,
  ChooseMitigation,
  CloseMitigationDiscussion,
  ContributeUpdate,
  CreateIncidentRoom,
  GetIncidentDashboard,
  JoinIncidentRoom,
  RepairMitigationEffects,
} = compositions;

test("exports the Incident Room endpoint set", () => {
  expect({
    AcknowledgeMitigationAlert,
    ChooseMitigation,
    CloseMitigationDiscussion,
    ContributeUpdate,
    CreateIncidentRoom,
    GetIncidentDashboard,
    JoinIncidentRoom,
    RepairMitigationEffects,
  }).toEqual({
    AcknowledgeMitigationAlert: expect.anything(),
    ChooseMitigation: expect.anything(),
    CloseMitigationDiscussion: expect.anything(),
    ContributeUpdate: expect.anything(),
    CreateIncidentRoom: expect.anything(),
    GetIncidentDashboard: expect.anything(),
    JoinIncidentRoom: expect.anything(),
    RepairMitigationEffects: expect.anything(),
  });
});
