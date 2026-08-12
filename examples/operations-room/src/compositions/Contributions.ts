import spec from "@design/compositions/Contributions.md" with { type: "text" };
import { endpoint, receive, respond } from "@mit-sdg/sync-engine/boundary";
import { type RelationView } from "@mit-sdg/sync-engine/language";
import { concepts } from "../vocabulary.ts";

export { spec };

const { Discussing, Selecting } = concepts;

/**
 * Contribution endpoints accept policy views from outside — the caller
 * selects which responder-is-a-member rule applies. The two endpoints share
 * one path and use deliberately disjoint views so exactly one matches. Endpoint
 * declaration order does not provide fall-through behavior.
 */
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
        .then(Discussing.respond({ discussion, author: responder, text }).responds({ response }))
        .then(respond({ response })),
  );

  const RejectContribution = endpoint("/rooms/contribute", ({ room, responder, text }) =>
    receive({ room, responder, text })
      .where(mayNotContribute({ responder, room }))
      .then(respond({ error: denied })),
  );

  return { AddContribution, RejectContribution };
}
