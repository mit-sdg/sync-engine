import { endpoint, receive, respond } from "@mit-sdg/sync-engine/boundary";
import { former, no, where } from "@mit-sdg/sync-engine/language";
import { concepts } from "./concept-set.ts";

const { Noting } = concepts;

export const notePage = former("the note (note)", ({ note }, { text }) =>
  where(Noting._get({ note }).is({ text })).form({ note, text }),
);

export const WriteNote = endpoint("/notes/write", ({ text, note }) =>
  receive({ text }).then(Noting.write({ text }).responds({ note })).then(respond({ note })),
);

export const GetNote = endpoint("/notes/get", ({ note }) =>
  receive({ note }).then(
    where(Noting._get({ note }))
      .then(respond({ page: notePage({ note }) }))
      .named("found"),
    where(no(Noting._get({ note })))
      .then(respond({ error: "NOTE_NOT_FOUND" }))
      .named("missing"),
  ),
);
