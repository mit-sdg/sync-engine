import { endpoint, receive, respond } from "@mit-sdg/sync-engine/boundary";
import { request, type RelationView } from "@mit-sdg/sync-engine/language";
import { concepts } from "../concept-set.ts";

const { Discussing, Selecting } = concepts;

export function contributionEndpoints({
  denied,
  mayContribute,
  mayNotContribute,
}: {
  denied: string;
  mayContribute: RelationView;
  mayNotContribute: RelationView;
}) {
  const AddContribution = endpoint(
    "/rooms/contribute",
    ({ room, responder, text, selection, discussion, response }) =>
      receive({ room, responder, text })
        .where(
          mayContribute({ responder, room }),
          Selecting._current({ scope: room }).is({ selection }),
          Discussing._openFor({ subject: selection }).is({ discussion }),
        )
        .then(
          request(Discussing.respond, { discussion, author: responder, text }, { response }),
          respond({ response }),
        ),
  );

  const RejectContribution = endpoint("/rooms/contribute", ({ room, responder, text }) =>
    receive({ room, responder, text })
      .where(mayNotContribute({ responder, room }))
      .then(respond({ error: denied })),
  );

  return { AddContribution, RejectContribution };
}
