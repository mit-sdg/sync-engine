import { endpoint, receive, respond } from "@mit-sdg/sync-engine/boundary";
import { each, former, whether, where } from "@mit-sdg/sync-engine/language";
import { concepts } from "@catalog/concepts";

const { Alerting, Discussing, Gathering, Selecting } = concepts;

/** A joined read of the room's coordination state. */
export const operationsDashboard = former(
  "the operations room (gathering)",
  (
    { gathering },
    {
      name,
      host,
      member,
      selection,
      item,
      discussion,
      response,
      author,
      text,
      alert,
      subject,
      alertedItem,
    },
  ) =>
    where(Gathering._get({ gathering }).is({ name, host })).form({
      gathering,
      name,
      host,
      members: each(Gathering._members({ gathering }).is({ member })).form({
        member,
        alerts: each(Alerting._openFor({ recipient: member }).is({ alert, subject }))
          .where(Selecting._get({ selection: subject }).is({ item: alertedItem }))
          .form({ alert, item: alertedItem }),
      }),
      current: where(
        whether(Selecting._current({ scope: gathering }).is({ selection, item })),
        whether(Discussing._openFor({ subject: selection }).is({ discussion })),
      ).form({
        item,
        discussion,
        responses: each(Discussing._responses({ discussion }).is({ response, author, text })).form({
          response,
          member: author,
          text,
        }),
      }),
    }),
);

export const CreateOperationsRoom = endpoint(
  "/rooms/create",
  ({ name, host, gathering }) =>
    receive({ name, host })
      .then(Gathering.create({ name, host }).responds({ gathering }))
      .then(respond({ gathering })),
);

export const JoinOperationsRoom = endpoint(
  "/rooms/join",
  ({ gathering, member, membership }) =>
    receive({ gathering, member })
      .then(Gathering.join({ gathering, member }).responds({ membership }))
      .then(respond({ member })),
);

export const ChooseOperationsItem = endpoint(
  "/rooms/choose",
  ({ gathering, item, selection }) =>
    receive({ gathering, item })
      .then(Selecting.choose({ scope: gathering, item }).responds({ selection }))
      .then(respond({ selection, item })),
);

export const GetOperationsRoom = endpoint("/rooms/get", ({ gathering }) =>
  receive({ gathering }).then(respond({ dashboard: operationsDashboard({ gathering }) })),
);
