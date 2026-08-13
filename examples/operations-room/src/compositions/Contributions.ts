import spec from "@design/compositions/Contributions.md" with { type: "text" };
import { endpoint, receive, respond } from "@mit-sdg/sync-engine/boundary";
import { type RelationView, view, where } from "@mit-sdg/sync-engine/language";
import { concepts } from "../vocabulary.ts";

export { spec };

const { Discussing, Gathering, Selecting } = concepts;

type ContributionPolicy = {
  denied: string;
  ResponderMayContribute: RelationView;
  ResponderMayNotContribute: RelationView;
};

function contributionEndpoints({
  denied,
  ResponderMayContribute,
  ResponderMayNotContribute,
}: ContributionPolicy) {
  const AddContribution = endpoint(
    "/rooms/contribute",
    ({ room, responder, text, selection, discussion, response }) =>
      receive({ room, responder, text })
        .where(
          ResponderMayContribute({ responder, room }),
          Selecting._current({ scope: room }).is({ selection }),
          Discussing._openFor({ subject: selection }).is({ discussion }),
        )
        .then(Discussing.respond({ discussion, author: responder, text }).responds({ response }))
        .then(respond({ response })),
  );

  const RejectContribution = endpoint("/rooms/contribute", ({ room, responder, text }) =>
    receive({ room, responder, text })
      .where(ResponderMayNotContribute({ responder, room }))
      .then(respond({ error: denied })),
  );

  return { AddContribution, RejectContribution };
}

const responderPolicy = {
  ResponderMayContribute: view(
    "(responder) may contribute in (room)",
    ({ responder, room }, _outputs, _bindings) =>
      where(Gathering._membership({ gathering: room, member: responder }).is({ joined: true })),
  ).holds(),
  ResponderMayNotContribute: view(
    "(responder) may not contribute in (room)",
    ({ responder, room }, _outputs, _bindings) =>
      where(Gathering._membership({ gathering: room, member: responder }).is({ joined: false })),
  ).holds(),
  denied: "RESPONDERS_ONLY",
};

const hostPolicy = {
  ResponderMayContribute: view(
    "(responder) may contribute in (room)",
    ({ responder, room }, _outputs, _bindings) =>
      where(Gathering._get({ gathering: room }).is({ host: responder })),
  ).holds(),
  ResponderMayNotContribute: view(
    "(responder) may not contribute in (room)",
    ({ responder, room }, _outputs, _bindings) =>
      where(Gathering._get({ gathering: room }).is.not({ host: responder })),
  ).holds(),
  denied: "HOST_ONLY",
};

export const views = {
  Responders: responderPolicy,
  Host: hostPolicy,
};

export const compositions = {
  Contributions: {
    Responders: contributionEndpoints(responderPolicy),
    Host: contributionEndpoints(hostPolicy),
  },
};
