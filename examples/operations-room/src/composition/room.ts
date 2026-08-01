/** Compose generic gathering and selection behavior as an operations room. */

import { endpoint, receive, respond } from "@mit-sdg/sync-engine/boundary";
import { each, form, former, whether, where } from "@mit-sdg/sync-engine/language";
import { concepts } from "../concept-set.ts";

const { Alerting, Discussing, Gathering, Selecting } = concepts;

/** Which responders belong to this room? */
export const responderRoster = former("the responder roster of (room)", (inputs, bindings) => {
  const room = inputs("room");
  const responder = bindings("responder");
  return form({
    responders: each(Gathering._members({ gathering: room }).is({ member: responder })).form({
      responder,
    }),
  });
});

/** Who is responding in this room? */
export const roomSummary = former("the room summary (room)", (inputs, bindings) => {
  const room = inputs("room");
  const { name, host } = bindings("name", "host");
  return where(Gathering._get({ gathering: room }).is({ name, host }))
    .form({ room, name, host })
    .splicing(responderRoster({ room })); // .splicing() pulls in another former's output
});

/** Which mitigation must this room currently have? */
export const requiredCurrentMitigation = former(
  "the required current mitigation (room)",
  (inputs, bindings) => {
    const room = inputs("room");
    const mitigation = bindings("mitigation");
    return where(Selecting._current({ scope: room }).is({ item: mitigation })).form({
      room,
      mitigation,
    });
  },
);

/** Which mitigation does this room currently have, if any? */
export const currentMitigation = former("the current mitigation (room)", (inputs, bindings) => {
  const room = inputs("room");
  const mitigation = bindings("mitigation");
  return where(Selecting._current({ scope: room }).is({ item: mitigation })).form({
    room,
    mitigation,
  });
}).optional(); // .optional() maps no matching row to null

/** How many responses does this discussion have, which came first, and who responded? */
export const responseStats = former("the response stats of (discussion)", (inputs, bindings) => {
  const discussion = inputs("discussion");
  const { response, responder } = bindings("response", "responder");
  return form({
    responseCount: each(
      Discussing._responses({ discussion }).is({ response, author: responder }),
    ).count(), // .count() returns the row count
    firstResponse: each(
      Discussing._responses({ discussion }).is({ response, author: responder }),
    ).first(response), // .first() returns the earliest row by that value
    responders: each(
      Discussing._responses({ discussion }).is({ response, author: responder }),
    ).distinct(responder), // .distinct() returns the unique values of that column
  });
});

/** What should responders see when opening an operations room? */
export const roomDashboard = former("the operations room (room)", (inputs, bindings) => {
  const room = inputs("room");
  const {
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
  } = bindings(
    "name",
    "host",
    "responder",
    "selection",
    "mitigation",
    "discussion",
    "response",
    "author",
    "text",
    "alert",
    "subject",
    "alertedMitigation",
  );
  return where(Gathering._get({ gathering: room }).is({ name, host })).form({
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
  });
});

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
