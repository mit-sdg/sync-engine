import { endpoint, receive, respond } from "@mit-sdg/sync-engine/boundary";
import { view, where } from "@mit-sdg/sync-engine/language";
import { concepts } from "@catalog/concepts";

const { Discussing, Gathering, Selecting } = concepts;

export const MemberMayContribute = view(
  "(member) may contribute in (gathering)",
  ({ member, gathering }, _outputs, _bindings) =>
    where(Gathering._membership({ gathering, member }).is({ joined: true })),
).holds();

export const MemberMayNotContribute = view(
  "(member) may not contribute in (gathering)",
  ({ member, gathering }, _outputs, _bindings) =>
    where(Gathering._membership({ gathering, member }).is({ joined: false })),
).holds();

export const AddMemberContribution = endpoint(
  "/rooms/contribute",
  ({ gathering, member, text, selection, discussion, response }) =>
    receive({ gathering, member, text })
      .where(
        MemberMayContribute({ member, gathering }),
        Selecting._current({ scope: gathering }).is({ selection }),
        Discussing._openFor({ subject: selection }).is({ discussion }),
      )
      .then(Discussing.respond({ discussion, author: member, text }).responds({ response }))
      .then(respond({ response })),
);

export const RejectNonmemberContribution = endpoint(
  "/rooms/contribute",
  ({ gathering, member, text }) =>
    receive({ gathering, member, text })
      .where(MemberMayNotContribute({ member, gathering }))
      .then(respond({ error: "MEMBERS_ONLY" })),
);
