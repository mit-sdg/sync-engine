import spec from "./spec.md";
import { endpoint, receive, respond } from "@mit-sdg/sync-engine/boundary";
import { each, former, no, view, where, whether } from "@mit-sdg/sync-engine/language";
import { concepts } from "@catalog/concepts";

const { Alerting, Discussing, Gathering, Selecting, Timing } = concepts;

const MemberOfRoom = view(
  "(member) belongs to incident room (room)",
  ({ member, room }, _outputs, _bindings) =>
    where(Gathering._membership({ gathering: room, member }).is({ joined: true })),
).holds();

const NotMemberOfRoom = view(
  "(member) does not belong to incident room (room)",
  ({ member, room }, _outputs, _bindings) =>
    where(Gathering._membership({ gathering: room, member }).is({ joined: false })),
).holds();

const OpenMitigationDiscussion = view(
  "the open mitigation discussion in incident room (room)",
  ({ room }, { discussion }, { selection }) =>
    where(
      Selecting._current({ scope: room }).is({ selection }),
      Discussing._openFor({ subject: selection }).is({ discussion }),
    ),
).optional();

const IncidentDashboard = former(
  "the incident room dashboard (room)",
  (
    { room },
    {
      name,
      host,
      member,
      alert,
      alertSelection,
      alertMitigation,
      raisedAt,
      selection,
      mitigation,
      discussion,
      openedAt,
      response,
      author,
      text,
      addedAt,
    },
  ) =>
    where(Gathering._get({ gathering: room }).is({ name, host })).form({
      room,
      name,
      host,
      members: each(Gathering._members({ gathering: room }).is({ member })).form({
        member,
        alerts: each(
          Alerting._openFor({ recipient: member }).is({
            alert,
            subject: alertSelection,
            cause: alertSelection,
            raisedAt,
          }),
        )
          .where(Selecting._get({ selection: alertSelection }).is({ item: alertMitigation }))
          .form({
            alert,
            selection: alertSelection,
            mitigation: alertMitigation,
            raisedAt,
          }),
      }),
      current: where(
        whether(Selecting._current({ scope: room }).is({ selection, item: mitigation })),
        whether(Discussing._openFor({ subject: selection }).is({ discussion, openedAt })),
      ).form({
        selection,
        mitigation,
        discussion,
        openedAt,
        responses: each(
          Discussing._responses({ discussion }).is({ response, author, text, addedAt }),
        ).form({ response, member: author, text, addedAt }),
      }),
    }),
);

const CreateIncidentRoom = endpoint("/incident-rooms/create", ({ name, host, room }) =>
  receive({ name, host })
    .then(Gathering.create({ name, host }).responds({ gathering: room }))
    .then(respond({ room })),
);

const JoinIncidentRoom = endpoint("/incident-rooms/join", ({ room, member, membership }) =>
  receive({ room, member })
    .then(Gathering.join({ gathering: room, member }).responds({ membership }))
    .then(respond({ membership })),
);

const ChooseMitigation = endpoint(
  "/incident-rooms/choose",
  ({ room, mitigation, selection, at, discussion, member }) =>
    receive({ room, mitigation })
      .where(Gathering._get({ gathering: room }))
      .then(Selecting.choose({ scope: room, item: mitigation }).responds({ selection }))
      .then(
        where(Timing._now({}).is({ time: at })).then(
          Discussing.open({ subject: selection, at }).responds({ discussion }),
        ),
      )
      .then(
        where(Gathering._members({ gathering: room }).is({ member })).then(
          Alerting.raise({
            recipient: member,
            subject: selection,
            cause: selection,
            at,
          }).responds({}),
        ),
      )
      .afterFlowSettles()
      .where(Discussing._openFor({ subject: selection }).is({ discussion }))
      .then(respond({ selection, discussion })),
);

const ContributeUpdate = endpoint(
  "/incident-rooms/contribute",
  ({ room, member, text, discussion, at, response }) =>
    receive({ room, member, text }).then(
      where(
        MemberOfRoom({ member, room }),
        OpenMitigationDiscussion({ room }).is({ discussion }),
        Timing._now({}).is({ time: at }),
      )
        .then(Discussing.respond({ discussion, author: member, text, at }).responds({ response }))
        .then(respond({ response }))
        .named("member"),
      where(NotMemberOfRoom({ member, room }))
        .then(respond({ error: "NOT_A_ROOM_MEMBER" }))
        .named("nonmember"),
      where(MemberOfRoom({ member, room }), no(OpenMitigationDiscussion({ room })))
        .then(respond({ error: "NO_OPEN_MITIGATION_DISCUSSION" }))
        .named("no-open-discussion"),
    ),
);

const CloseMitigationDiscussion = endpoint(
  "/incident-rooms/close-discussion",
  ({ room, discussion, at }) =>
    receive({ room }).then(
      where(OpenMitigationDiscussion({ room }).is({ discussion }), Timing._now({}).is({ time: at }))
        .then(Discussing.close({ discussion, at }).responds({ discussion }))
        .then(respond({ discussion }))
        .named("open"),
      where(no(OpenMitigationDiscussion({ room })))
        .then(respond({ error: "NO_OPEN_MITIGATION_DISCUSSION" }))
        .named("not-open"),
    ),
);

const AcknowledgeMitigationAlert = endpoint("/incident-rooms/acknowledge", ({ alert, member }) =>
  receive({ alert, member })
    .then(Alerting.acknowledge({ alert, recipient: member }).responds({ alert }))
    .then(respond({ alert })),
);

// Repair one member from the original selection-time roster. The route does not
// enumerate current members, so it can repair a departed recipient without
// backfilling an alert for somebody who joined after the selection.
const RepairMitigationEffects = endpoint(
  "/incident-rooms/repair",
  ({ room, selection, member, at, discussion, alert }) =>
    receive({ room, selection, member })
      .where(Selecting._get({ selection }).is({ scope: room }))
      .then(
        where(Discussing._openFor({ subject: selection }).is({ openedAt: at }))
          .then(
            Alerting.raise({
              recipient: member,
              subject: selection,
              cause: selection,
              at,
            }).responds({ alert }),
          )
          .named("discussion-exists"),
        where(no(Discussing._openFor({ subject: selection })), Timing._now({}).is({ time: at }))
          .then(Discussing.open({ subject: selection, at }).responds({ discussion }))
          .then(
            Alerting.raise({
              recipient: member,
              subject: selection,
              cause: selection,
              at,
            }).responds({ alert }),
          )
          .named("discussion-missing"),
      )
      .afterFlowSettles()
      .where(Discussing._openFor({ subject: selection }).is({ discussion }))
      .then(respond({ selection, discussion, alert })),
);

const GetIncidentDashboard = endpoint("/incident-rooms/dashboard", ({ room }) =>
  receive({ room }).then(respond({ dashboard: IncidentDashboard({ room }) })),
);

export { spec };

export const compositions = {
  RoomMembership: { CreateIncidentRoom, JoinIncidentRoom },
  MitigationDiscussion: { ChooseMitigation, ContributeUpdate, CloseMitigationDiscussion },
  MitigationAlerts: { AcknowledgeMitigationAlert, RepairMitigationEffects },
  IncidentDashboard: { GetIncidentDashboard },
};
export const views = { MemberOfRoom, NotMemberOfRoom, OpenMitigationDiscussion };
export const formers = { IncidentDashboard };
