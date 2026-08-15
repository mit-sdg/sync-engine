import { endpoint, receive, respond } from "@mit-sdg/sync-engine/boundary";
import { former, reaction, when, where } from "@mit-sdg/sync-engine/language";
import { concepts } from "../concepts.ts";

const { Mitigating, Rooming } = concepts;

// @ts-expect-error Action response patterns accept only declared output fields.
Rooming.open({ name: "type-check" }).responds({ typo: Symbol("room") });

// @ts-expect-error Action response fields retain the implementation's declared output types.
Rooming.open({ name: "type-check" }).responds({ room: 1 });

export const RoomStartsWithInvestigation = reaction(({ room }) =>
  when(Rooming.open({}).responds({ room })).then(
    Mitigating.choose({ room, mitigation: "investigate" }),
  ),
);

export const roomDashboard = former(
  "the operations room (room)",
  ({ room }, { name, mitigation }) =>
    where(
      Rooming._get({ room }).is({ name }),
      Mitigating._current({ room }).is({ mitigation }),
    ).form({ room, name, mitigation }),
);

export const OpenRoom = endpoint("/rooms/open", ({ name, room }) =>
  receive({ name }).then(Rooming.open({ name }).responds({ room })).then(respond({ room })),
);

export const GetRoom = endpoint("/rooms/get", ({ room }) =>
  receive({ room }).then(respond({ dashboard: roomDashboard({ room }) })),
);
