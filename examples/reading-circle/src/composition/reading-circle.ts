/** Compose generic gathering, selection, and discussion behavior as a reading circle. */

import { endpoint, receive, respond } from "@mit-sdg/sync-engine/boundary";
import { former, reaction, each, view, when, where } from "@mit-sdg/sync-engine/language";
import { concepts } from "../concept-set.ts";

const { Discussing, Gathering, Selecting } = concepts;

// ── Policy views ─────────────────────────────────────────────────────────
// Views return the rows matching their name. A success view drives the `where()`
// clause of an accepting endpoint; an inverted view drives a rejecting endpoint
// on the same path — the engine tries both in declaration order, short-
// circuiting on the first match.

export const memberMayRespond = view(
  "(member) may respond in (circle)",
  ({ member, circle }, _outputs, _bindings) =>
    where(Gathering._membership({ gathering: circle, member }).is({ joined: true })),
).holds();

export const nonmemberMayNotRespond = view(
  "(member) may not respond in (circle)",
  ({ member, circle }, _outputs, _bindings) =>
    where(Gathering._membership({ gathering: circle, member }).is({ joined: false })),
).holds();

export const SelectedReadingOpensDiscussion = reaction(({ selection }) =>
  // An empty input pattern ({}) matches any choose regardless of scope or item.
  when(Selecting.choose({}).responds({ selection })).then(Discussing.open({ subject: selection })),
);

/** What should a reader see when opening a circle? */
export const circlePage = former(
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

export const CreateCircle = endpoint("/circles/create", ({ name, host, circle }) =>
  receive({ name, host })
    .then(Gathering.create({ name, host }).responds({ gathering: circle }))
    .then(respond({ circle })),
);

export const JoinCircle = endpoint("/circles/join", ({ circle, member, membership }) =>
  receive({ circle, member })
    .then(Gathering.join({ gathering: circle, member }).responds({ membership }))
    .then(respond({ member })),
);

export const ChooseReading = endpoint("/circles/choose", ({ circle, reading, selection }) =>
  receive({ circle, reading })
    .then(Selecting.choose({ scope: circle, item: reading }).responds({ selection }))
    .then(respond({ reading })),
);

// ── Endpoints ────────────────────────────────────────────────────────────
// The two /circles/respond endpoints share one path. The engine tries them in
// declaration order: AddResponse checks membership and processes the response;
// if its where() rejects, RejectNonmemberResponse answers with an error.

export const AddResponse = endpoint(
  "/circles/respond",
  ({ circle, reading, member, text, selection, discussion, response }) =>
    receive({ circle, reading, member, text })
      .where(
        memberMayRespond({ member, circle }),
        Selecting._current({ scope: circle }).is({ selection, item: reading }),
        Discussing._openFor({ subject: selection }).is({ discussion }),
      )
      .then(Discussing.respond({ discussion, author: member, text }).responds({ response }))
      .then(respond({ response })),
);

export const RejectNonmemberResponse = endpoint(
  "/circles/respond",
  ({ circle, reading, member, text }) =>
    receive({ circle, reading, member, text })
      .where(nonmemberMayNotRespond({ member, circle }))
      .then(respond({ error: "NOT_A_MEMBER" })),
);

export const GetCirclePage = endpoint("/circles/page", ({ circle }) =>
  receive({ circle }).then(respond({ page: circlePage({ circle }) })),
);
