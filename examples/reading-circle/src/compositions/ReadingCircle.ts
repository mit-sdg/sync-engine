/** Compose generic gathering, selection, and discussion behavior as a reading circle. */

import spec from "@design/compositions/ReadingCircle.md" with { type: "text" };
import { endpoint, receive, respond } from "@mit-sdg/sync-engine/boundary";
import { former, reaction, each, view, when, where } from "@mit-sdg/sync-engine/language";
import { concepts } from "../vocabulary.ts";

export { spec };

const { Discussing, Gathering, Selecting } = concepts;

const MemberMayRespond = view(
  "(member) may respond in (circle)",
  ({ member, circle }, _outputs, _bindings) =>
    where(Gathering._membership({ gathering: circle, member }).is({ joined: true })),
).holds();

const NonmemberMayNotRespond = view(
  "(member) may not respond in (circle)",
  ({ member, circle }, _outputs, _bindings) =>
    where(Gathering._membership({ gathering: circle, member }).is({ joined: false })),
).holds();

const SelectedReadingOpensDiscussion = reaction(({ selection }) =>
  // An empty input pattern ({}) matches any choose regardless of scope or item.
  when(Selecting.choose({}).responds({ selection })).then(Discussing.open({ subject: selection })),
);

const CirclePage = former(
  "the circle page (circle)",
  ({ circle }, { name, host, member, selection, reading, discussion, response, author, text }) =>
    where(Gathering._get({ gathering: circle }).is({ name, host })).form({
      circle,
      name,
      host,
      members: each(Gathering._members({ gathering: circle }).is({ member })).form({ member }),
      reading: where(
        Selecting._current({ scope: circle }).is({ selection, item: reading }),
        Discussing._openFor({ subject: selection }).is({ discussion }),
      ).form({
        reading,
        responses: each(Discussing._responses({ discussion }).is({ response, author, text })).form({
          response,
          member: author,
          text,
        }),
      }),
    }),
);

const CreateCircle = endpoint("/circles/create", ({ name, host, circle }) =>
  receive({ name, host })
    .then(Gathering.create({ name, host }).responds({ gathering: circle }))
    .then(respond({ circle })),
);

const JoinCircle = endpoint("/circles/join", ({ circle, member, membership }) =>
  receive({ circle, member })
    .then(Gathering.join({ gathering: circle, member }).responds({ membership }))
    .then(respond({ member })),
);

const ChooseReading = endpoint("/circles/choose", ({ circle, reading, selection }) =>
  receive({ circle, reading })
    .then(Selecting.choose({ scope: circle, item: reading }).responds({ selection }))
    .then(respond({ reading })),
);

// These endpoints share one path and use deliberately disjoint membership views.
const AddResponse = endpoint(
  "/circles/respond",
  ({ circle, reading, member, text, selection, discussion, response }) =>
    receive({ circle, reading, member, text })
      .where(
        MemberMayRespond({ member, circle }),
        Selecting._current({ scope: circle }).is({ selection, item: reading }),
        Discussing._openFor({ subject: selection }).is({ discussion }),
      )
      .then(Discussing.respond({ discussion, author: member, text }).responds({ response }))
      .then(respond({ response })),
);

const RejectNonmemberResponse = endpoint("/circles/respond", ({ circle, reading, member, text }) =>
  receive({ circle, reading, member, text })
    .where(NonmemberMayNotRespond({ member, circle }))
    .then(respond({ error: "NOT_A_MEMBER" })),
);

const GetCirclePage = endpoint("/circles/page", ({ circle }) =>
  receive({ circle }).then(respond({ page: CirclePage({ circle }) })),
);

export const compositions = {
  CircleMembership: { CreateCircle, JoinCircle },
  ReadingDiscussion: {
    SelectedReadingOpensDiscussion,
    ChooseReading,
    AddResponse,
    RejectNonmemberResponse,
  },
  CirclePages: { GetCirclePage },
};

export const views = { MemberMayRespond, NonmemberMayNotRespond };
export const formers = { CirclePage };
