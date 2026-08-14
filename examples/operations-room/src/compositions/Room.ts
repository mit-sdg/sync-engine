import { endpoint, receive, respond } from "@mit-sdg/sync-engine/boundary";
import { each, form, former, whether, where } from "@mit-sdg/sync-engine/language";
import { concepts } from "../vocabulary.ts";

const { Alerting, Discussing, Gathering, Selecting } = concepts;

const CreateRoom = endpoint("/rooms/create", ({ name, host, room }) =>
  receive({ name, host })
    .then(Gathering.create({ name, host }).responds({ gathering: room }))
    .then(respond({ room })),
);

const JoinRoom = endpoint("/rooms/join", ({ room, responder, membership }) =>
  receive({ room, responder })
    .then(Gathering.join({ gathering: room, member: responder }).responds({ membership }))
    .then(respond({ responder })),
);

const ChooseMitigation = endpoint("/rooms/choose-mitigation", ({ room, mitigation, selection }) =>
  receive({ room, mitigation })
    .then(Selecting.choose({ scope: room, item: mitigation }).responds({ selection }))
    .then(respond({ mitigation })),
);

const GetRoom = endpoint("/rooms/get", ({ room }) =>
  receive({ room }).then(respond({ dashboard: roomDashboard({ room }) })),
);

/** Which responders belong to this room? */
const responderRoster = former("the responder roster of (room)", ({ room }, { responder }) =>
  form({
    responders: each(Gathering._members({ gathering: room }).is({ member: responder })).form({
      responder,
    }),
  }),
);

/** Who is responding in this room? */
const roomSummary = former(
  "the room summary (room)",
  ({ room }, { name, host }) =>
    where(Gathering._get({ gathering: room }).is({ name, host }))
      .form({ room, name, host })
      .splicing(responderRoster({ room })), // .splicing() pulls in another former's output
);

/** Which mitigation must this room currently have? */
const requiredCurrentMitigation = former(
  "the required current mitigation (room)",
  ({ room }, { mitigation }) =>
    where(Selecting._current({ scope: room }).is({ item: mitigation })).form({ room, mitigation }),
);

/** Which mitigation does this room currently have, if any? */
const currentMitigation = former("the current mitigation (room)", ({ room }, { mitigation }) =>
  where(Selecting._current({ scope: room }).is({ item: mitigation })).form({ room, mitigation }),
).optional(); // .optional() maps no matching row to null

/** How many responses does this discussion have, which came first, and who responded? */
const responseStats = former(
  "the response stats of (discussion)",
  ({ discussion }, { response, responder }) =>
    form({
      responseCount: each(
        Discussing._responses({ discussion }).is({ response, author: responder }),
      ).count(), // .count() returns the row count
      firstResponse: each(
        Discussing._responses({ discussion }).is({ response, author: responder }),
      ).first(response), // .first() returns the earliest row by that value
      responders: each(
        Discussing._responses({ discussion }).is({ response, author: responder }),
      ).distinct(responder), // .distinct() returns the unique values of that column
    }),
);

/** What should responders see when opening an operations room? */
const roomDashboard = former(
  "the operations room (room)",
  (
    { room },
    {
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
    },
  ) =>
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
        whether(Selecting._current({ scope: room }).is({ selection, item: mitigation })), // whether() allows optional matching — the row still exists if no selection is found
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

export const formers = {
  ResponderRoster: responderRoster,
  RoomSummary: roomSummary,
  RequiredCurrentMitigation: requiredCurrentMitigation,
  CurrentMitigation: currentMitigation,
  ResponseStats: responseStats,
  RoomDashboard: roomDashboard,
};

export const composition = {
  RoomMembership: { CreateRoom, JoinRoom },
  MitigationSelection: { ChooseMitigation },
  RoomDashboard: { GetRoom, RoomDashboard: formers.RoomDashboard },
  ReadModels: {
    ResponderRoster: formers.ResponderRoster,
    RoomSummary: formers.RoomSummary,
    RequiredCurrentMitigation: formers.RequiredCurrentMitigation,
    CurrentMitigation: formers.CurrentMitigation,
    ResponseStats: formers.ResponseStats,
  },
};
