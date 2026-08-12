import spec from "@design/compositions/Room.md" with { type: "text" };
import { endpoint, receive, respond } from "@mit-sdg/sync-engine/boundary";
import { concepts } from "../vocabulary.ts";
import { roomDashboard } from "../formers/Room.ts";

export { spec };

const { Gathering, Selecting } = concepts;

export const CreateRoom = endpoint("/rooms/create", ({ name, host, room }) =>
  receive({ name, host })
    .then(Gathering.create({ name, host }).responds({ gathering: room }))
    .then(respond({ room })),
);

export const JoinRoom = endpoint("/rooms/join", ({ room, responder, membership }) =>
  receive({ room, responder })
    .then(Gathering.join({ gathering: room, member: responder }).responds({ membership }))
    .then(respond({ responder })),
);

export const ChooseMitigation = endpoint(
  "/rooms/choose-mitigation",
  ({ room, mitigation, selection }) =>
    receive({ room, mitigation })
      .then(Selecting.choose({ scope: room, item: mitigation }).responds({ selection }))
      .then(respond({ mitigation })),
);

export const GetRoom = endpoint("/rooms/get", ({ room }) =>
  receive({ room }).then(respond({ dashboard: roomDashboard({ room }) })),
);
