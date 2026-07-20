import { endpoint, receive, respond } from "@mit-sdg/sync-engine/boundary";
import { former, reaction, request, when, where } from "@mit-sdg/sync-engine/language";
import { concepts } from "./concept-set.ts";

const { Mitigating, Rooming } = concepts;

export const RoomStartsWithInvestigation = reaction(({ room }) =>
  when(Rooming.open, {}, { room }).then(
    request(Mitigating.choose, { room, mitigation: "investigate" }),
  ),
);

export const roomDashboard = former("the operations room (room)", ({ room, name, mitigation }) =>
  where(Rooming._get({ room }).is({ name }), Mitigating._current({ room }).is({ mitigation })).form(
    { room, name, mitigation },
  ),
);

export const OpenRoom = endpoint("/rooms/open", ({ name, room }) =>
  receive({ name }).then(request(Rooming.open, { name }, { room }), respond({ room })),
);

export const GetRoom = endpoint("/rooms/get", ({ room }) =>
  receive({ room }).then(respond({ dashboard: roomDashboard(room) })),
);
