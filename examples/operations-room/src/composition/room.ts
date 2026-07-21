/** Compose generic gathering and selection behavior as an operations room. */

import { endpoint, receive, respond } from "@mit-sdg/sync-engine/boundary";
import { each, form, former, whether, where } from "@mit-sdg/sync-engine/language";
import { concepts } from "../concept-set.ts";

const { Alerting, Discussing, Gathering, Selecting } = concepts;

/** Which responders belong to this room? */
export const responderRoster = former("the responder roster of (room)", ({ room, responder }) =>
  form({
    responders: each(Gathering._members({ gathering: room }).is({ member: responder })).form({
      responder,
    }),
  }),
);

/** Who is responding in this room? */
export const roomSummary = former("the room summary (room)", ({ room, name, host }) =>
  where(Gathering._get({ gathering: room }).is({ name, host }))
    .form({ room, name, host })
    .splicing(responderRoster(room)),
);

/** Which mitigation must this room currently have? */
export const requiredCurrentMitigation = former(
  "the required current mitigation (room)",
  ({ room, mitigation }) =>
    where(Selecting._current({ scope: room }).is({ item: mitigation })).form({ room, mitigation }),
);

/** Which mitigation does this room currently have, if any? */
export const currentMitigation = former(
  "the current mitigation (room), if any",
  ({ room, mitigation }) =>
    where(Selecting._current({ scope: room }).is({ item: mitigation })).form({ room, mitigation }),
);

/** How many responses does this discussion have, which came first, and who responded? */
export const responseStats = former(
  "the response stats of (discussion)",
  ({ discussion, response, responder }) =>
    form({
      responseCount: each(
        Discussing._responses({ discussion }).is({ response, author: responder }),
      ).count(),
      firstResponse: each(
        Discussing._responses({ discussion }).is({ response, author: responder }),
      ).first(response),
      responders: each(
        Discussing._responses({ discussion }).is({ response, author: responder }),
      ).distinct(responder),
    }),
);

/** What should responders see when opening an operations room? */
export const roomDashboard = former(
  "the operations room (room)",
  ({
    room,
    name,
    host,
    responder,
    selection,
    mitigation,
    discussion,
    response,
    author,
    text,
    alert,
    subject,
    alertedMitigation,
  }) =>
    where(Gathering._get({ gathering: room }).is({ name, host })).form({
      room,
      name,
      host,
      responders: each(Gathering._members({ gathering: room }).is({ member: responder })).form({
        responder,
        alerts: each(Alerting._openFor({ recipient: responder }).is({ alert, subject }))
          .where(Selecting._get({ selection: subject }).is({ item: alertedMitigation }))
          .form({ alert, mitigation: alertedMitigation }),
      }),
      current: where(
        whether(Selecting._current({ scope: room }).is({ selection, item: mitigation })),
        whether(Discussing._openFor({ subject: selection }).is({ discussion })),
      ).form({
        mitigation,
        discussion,
        responses: each(Discussing._responses({ discussion }).is({ response, author, text })).form({
          response,
          responder: author,
          text,
        }),
        responseCount: each(
          Discussing._responses({ discussion }).is({ response, author, text }),
        ).count(),
      }),
    }),
);

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
  receive({ room }).then(respond({ dashboard: roomDashboard(room) })),
);
