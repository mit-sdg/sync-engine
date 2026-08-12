/** Shared read models for the operations room. */

import { each, form, former, whether, where } from "@mit-sdg/sync-engine/language";
import { concepts } from "../vocabulary.ts";

const { Alerting, Discussing, Gathering, Selecting } = concepts;

/** Which responders belong to this room? */
export const responderRoster = former("the responder roster of (room)", ({ room }, { responder }) =>
  form({
    responders: each(Gathering._members({ gathering: room }).is({ member: responder })).form({
      responder,
    }),
  }),
);

/** Who is responding in this room? */
export const roomSummary = former(
  "the room summary (room)",
  ({ room }, { name, host }) =>
    where(Gathering._get({ gathering: room }).is({ name, host }))
      .form({ room, name, host })
      .splicing(responderRoster({ room })), // .splicing() pulls in another former's output
);

/** Which mitigation must this room currently have? */
export const requiredCurrentMitigation = former(
  "the required current mitigation (room)",
  ({ room }, { mitigation }) =>
    where(Selecting._current({ scope: room }).is({ item: mitigation })).form({ room, mitigation }),
);

/** Which mitigation does this room currently have, if any? */
export const currentMitigation = former(
  "the current mitigation (room)",
  ({ room }, { mitigation }) =>
    where(Selecting._current({ scope: room }).is({ item: mitigation })).form({ room, mitigation }),
).optional(); // .optional() maps no matching row to null

/** How many responses does this discussion have, which came first, and who responded? */
export const responseStats = former(
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
export const roomDashboard = former(
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
