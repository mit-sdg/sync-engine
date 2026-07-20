/**
 * Executable sources for `docs/book.md`. The documentation test keeps its
 * TypeScript excerpts byte-exact with this file and checks quoted read-backs
 * and registration errors against a live engine.
 *
 * Examples use public package subpaths wherever an application can. The test
 * imports internal assembly only to call `engine.form(...)` directly;
 * applications inspect an assembly through the public `tooling` subpath.
 */
import { readFile } from "node:fs/promises";
import { describe, expect, test } from "vite-plus/test";
import {
  each,
  former,
  no,
  reaction,
  request,
  view,
  when,
  where,
  whether,
} from "@mit-sdg/sync-engine/language";
import { endpoint, receive, respond } from "@mit-sdg/sync-engine/boundary";
import { assemble } from "@sync-engine/internal/boundary";
import { concepts, vocabulary as words } from "../../examples/reading-circle/src/concept-set.ts";

const { Discussing, Gathering, Selecting } = concepts;

// ── The entries, in the book's order ────────────────────────────────────────

const ClearedReadingClosesDiscussion = reaction(({ selection, discussion }) =>
  when(Selecting.clear, {}, { selection })
    .where(Discussing._openFor({ subject: selection }).is({ discussion }))
    .then(request(Discussing.close, { discussion })),
);

const theStandingOf = view(
  "the standing of (member) in (circle) with one (joined)",
  ({ member, circle, joined }) =>
    where(Gathering._membership({ gathering: circle, member }).is({ joined })),
);

const memberMayRespond = view("(member) may respond in (circle)", ({ member, circle }) =>
  where(Gathering._membership({ gathering: circle, member }).is({ joined: true })),
);

const nonmemberMayNotRespond = view("(member) may not respond in (circle)", ({ member, circle }) =>
  where(Gathering._membership({ gathering: circle, member }).is({ joined: false })),
);

const HostLeavingDissolvesCircle = reaction(({ circle, host, member }) =>
  when(Gathering.leave, { gathering: circle, member: host }, {})
    .where(
      Gathering._get({ gathering: circle }).is({ host }),
      Gathering._members({ gathering: circle }).is({ member }),
    )
    .then(request(Gathering.leave, { gathering: circle, member })),
);

const OpenDiscussionOnce = reaction(({ selection }) =>
  when(Selecting.choose, {}, { selection })
    .where(no(Discussing._openFor({ subject: selection })))
    .then(request(Discussing.open, { subject: selection })),
);

const theOpenDiscussionOf = view(
  "the open discussion of (circle) with optional (discussion)",
  ({ circle, selection, discussion }) =>
    where(
      Selecting._current({ scope: circle }).is({ selection }),
      Discussing._openFor({ subject: selection }).is({ discussion }),
    ),
);

const theCircleCard = former("the circle card (circle)", ({ circle, name, host, reading }) =>
  where(
    Gathering._get({ gathering: circle }).is({ name, host }),
    whether(Selecting._current({ scope: circle }).is({ item: reading })),
  ).form({ name, host, reading }),
);

const theCurrentReadingOf = former(
  "the current reading of (circle), if any",
  ({ circle, reading }) =>
    where(Selecting._current({ scope: circle }).is({ item: reading })).form({ reading }),
);

const theResponseCountOf = former(
  "the response count of (discussion)",
  ({ discussion, response }) =>
    each(Discussing._responses({ discussion }).is({ response })).count(),
);

const AddResponse = endpoint(
  "/circles/respond",
  ({ circle, reading, member, text, selection, discussion, response }) =>
    receive({ circle, reading, member, text })
      .where(
        memberMayRespond({ member, circle }),
        Selecting._current({ scope: circle }).is({ selection, item: reading }),
        Discussing._openFor({ subject: selection }).is({ discussion }),
      )
      .then(
        request(Discussing.respond, { discussion, author: member, text }, { response }),
        respond({ response }),
      ),
);

const RejectNonmemberResponse = endpoint("/circles/respond", ({ circle, reading, member, text }) =>
  receive({ circle, reading, member, text })
    .where(nonmemberMayNotRespond({ member, circle }))
    .then(respond({ error: "NOT_A_MEMBER" })),
);

const LeavingRoutesByHost = reaction(({ circle, member }) =>
  when(Gathering.leave, { gathering: circle, member }, {})
    .where(Selecting._current({ scope: circle }))
    .either(
      where(Gathering._get({ gathering: circle }).is.not({ host: member })).then(
        request(Selecting.clear, { scope: circle }),
      ),
      where(Gathering._get({ gathering: circle }).is({ host: member })).then(
        request(Discussing.open, { subject: circle }),
      ),
    ),
);

const ChooseReadingHostOnly = endpoint(
  "/circles/choose",
  ({ circle, member, reading, selection }) =>
    receive({ circle, member, reading }).either(
      where(Gathering._get({ gathering: circle }).is.not({ host: member })).then(
        respond({ error: "HOST_ONLY" }),
      ),
      where(Gathering._get({ gathering: circle }).is({ host: member })).then(
        request(Selecting.choose, { scope: circle, item: reading }, { selection }),
        respond({ selection }),
      ),
    ),
);

const GetCircleName = endpoint("/circles/name", ({ circle, name }) =>
  receive({ circle }).either(
    where(Gathering._get({ gathering: circle }).is({ name })).then(respond({ name })),
    where(no(Gathering._get({ gathering: circle }))).then(respond({ error: "NO_SUCH_CIRCLE" })),
  ),
);

const theCircleActivityOf = former(
  "the circle activity of (circle)",
  ({ circle, selection, reading, discussion }) =>
    where(
      whether(Selecting._current({ scope: circle }).is({ selection, item: reading })),
      whether(Discussing._openFor({ subject: selection }).is({ discussion })),
    ).form({ reading, discussion }),
);

const theRespondedCircleActivityOf = former(
  "the responded circle activity of (circle), if any",
  ({ circle, selection, reading, discussion }) =>
    where(
      whether(Selecting._current({ scope: circle }).is({ selection, item: reading })),
      whether(Discussing._openFor({ subject: selection }).is({ discussion })),
      Discussing._responses({ discussion }),
    ).form({ reading, discussion }),
);

// ── The caught mistakes — each rejected at registration ─────────────────────

const CloseTheAbsentDiscussion = reaction(({ selection, discussion }) =>
  when(Selecting.clear, {}, { selection })
    .where(no(Discussing._openFor({ subject: selection }).is({ discussion })))
    .then(request(Discussing.close, { discussion })),
);

const ReopenOnJoin = reaction(({ circle, selection, reading }) =>
  when(Gathering.join, { gathering: circle }, {})
    .where(Selecting._current({ scope: circle }).is({ selection, item: reading }))
    .then(request(Discussing.open, { subject: selection })),
);

const GetCircleNameFirstDraft = endpoint("/circles/name", ({ circle, name }) =>
  receive({ circle }).either(
    where(Gathering._get({ gathering: circle }).is({ name })).then(respond({ name })),
    where(Gathering._get({ gathering: circle })).then(respond({ error: "NO_SUCH_CIRCLE" })),
  ),
);

const theFirstReadingOf = former("the first reading of (circle)", ({ circle, reading }) =>
  each(Selecting._current({ scope: circle }).is({ item: reading })).first(reading),
);

const theMemberCard = former("the member card (circle)", ({ circle, member }) =>
  where(Gathering._members({ gathering: circle }).is({ member })).form({ member }),
);

// ── The pins ────────────────────────────────────────────────────────────────

const readBackPins = [
  [
    "book.ClearedReadingClosesDiscussion",
    "  when Selecting.clear — opens (selection)",
    "  Discussing._openFor (subject: selection) has (discussion) — fills or drops the case; opens (discussion)",
    "  then request Discussing.close (discussion)",
  ],
  [
    "the standing of (member) in (circle) — promises exactly one (joined); the body proves it",
    "  Gathering._membership (gathering: circle, member) has (joined) — always fills; opens (joined)",
  ],
  [
    "(member) may respond in (circle) — a predicate: holds or not",
    "  Gathering._membership (gathering: circle, member) has (joined: true) — existence — fires once or drops the case",
  ],
  [
    "book.HostLeavingDissolvesCircle",
    "  when Gathering.leave — opens (circle, host)",
    "  Gathering._get (gathering: circle) has (host) — existence — fires once or drops the case",
    "  Gathering._members (gathering: circle) has (member) — fans out once per distinct fill; opens (member)",
    "  then request Gathering.leave (gathering: circle, member)",
  ],
  [
    "book.OpenDiscussionOnce",
    "  when Selecting.choose — opens (selection)",
    "  no Discussing._openFor (subject: selection) — holds only when no such row exists — drops the case otherwise",
    "  then request Discussing.open (subject: selection)",
  ],
  [
    "the open discussion of (circle) — promises at most one (discussion); the body proves it",
    "  Selecting._current (scope: circle) has (selection) — fills or drops the case; opens (selection)",
    "  Discussing._openFor (subject: selection) has (discussion) — fills or drops the case; opens (discussion)",
  ],
  [
    "the circle card (circle) — promises exactly one; the body proves at most one — the declaration is enforced at run",
  ],
  ["the current reading of (circle) — promises at most one; the body proves it"],
  ["the response count of (discussion) — promises exactly one; the body proves it"],
  [
    "book.AddResponse",
    "  when RequestBoundary.request — opens (circle, reading, member, text, requestId)",
    "  member may respond in circle — existence — fires once or drops the case",
    "  Selecting._current (scope: circle) has (selection, item: reading) — fills or drops the case; opens (selection); tests (item) — may drop the case",
    "  Discussing._openFor (subject: selection) has (discussion) — fills or drops the case; opens (discussion)",
    "  then request Discussing.respond (discussion, author: member, text)",
  ],
  [
    "book.AddResponse#2",
    "  when Discussing.respond — opens (discussion, member, text, response)",
    '  earlier, RequestBoundary.request (circle, reading, member, text, requestId, path: "/circles/respond") — reads the flow\'s record, once per matching occurrence',
    "  then request RequestBoundary.respond (response, requestId)",
  ],
  [
    "book.RejectNonmemberResponse",
    "  when RequestBoundary.request — opens (circle, reading, member, text, requestId)",
    "  member may not respond in circle — existence — fires once or drops the case",
    '  then request RequestBoundary.respond (error: "NOT_A_MEMBER", requestId)',
  ],
  [
    "book.LeavingRoutesByHost",
    "  when Gathering.leave — opens (circle, member)",
    "  Selecting._current (scope: circle) — existence — fires once or drops the case",
    "  Gathering._get (gathering: circle) and not (host: member) — existence — fires once or drops the case",
    "  then request Selecting.clear (scope: circle)",
    "  assumes Selecting._current fills",
    "  assumes Gathering._get fills",
  ],
  [
    "book.LeavingRoutesByHost:2",
    "  when Gathering.leave — opens (circle, member)",
    "  Selecting._current (scope: circle) — existence — fires once or drops the case",
    "  Gathering._get (gathering: circle) has (host: member) — existence — fires once or drops the case",
    "  then request Discussing.open (subject: circle)",
    "  assumes Selecting._current fills",
    "  assumes Gathering._get fills",
  ],
  [
    "book.ChooseReadingHostOnly",
    "  when RequestBoundary.request — opens (circle, member, reading, requestId)",
    "  Gathering._get (gathering: circle) and not (host: member) — existence — fires once or drops the case",
    '  then request RequestBoundary.respond (error: "HOST_ONLY", requestId)',
    "  assumes Gathering._get fills",
  ],
  [
    "book.ChooseReadingHostOnly:2",
    "  when RequestBoundary.request — opens (circle, member, reading, requestId)",
    "  Gathering._get (gathering: circle) has (host: member) — existence — fires once or drops the case",
    "  then request Selecting.choose (scope: circle, item: reading)",
    "  assumes Gathering._get fills",
  ],
  [
    "book.ChooseReadingHostOnly:2#2",
    "  when Selecting.choose — opens (circle, reading, selection)",
    '  earlier, RequestBoundary.request (circle, member, reading, requestId, path: "/circles/choose") — reads the flow\'s record, once per matching occurrence',
    "  then request RequestBoundary.respond (selection, requestId)",
    "  assumes Gathering._get fills",
  ],
  [
    "book.GetCircleName",
    "  when RequestBoundary.request — opens (circle, requestId)",
    "  Gathering._get (gathering: circle) has (name) — fills or drops the case; opens (name)",
    "  then request RequestBoundary.respond (name, requestId)",
  ],
  [
    "book.GetCircleName:2",
    "  when RequestBoundary.request — opens (circle, requestId)",
    "  no Gathering._get (gathering: circle) — holds only when no such row exists — drops the case otherwise",
    '  then request RequestBoundary.respond (error: "NO_SUCH_CIRCLE", requestId)',
  ],
  ["the circle activity of (circle) — promises exactly one; the body proves it"],
  ["the responded circle activity of (circle) — promises at most one; the body proves it"],
].map((section) => section.join("\n"));

const errorPins = {
  freshUnderNo:
    'Reaction "bad.CloseTheAbsentDiscussion": "discussion" is new inside no Discussing._openFor; no(...) can only test names bound by an earlier plain line.',
  unusedName:
    'Reaction "bad.ReopenOnJoin": "reading" is opened and never used — omit the key instead.',
  noWitness:
    "either(...): cases 1 and 2 can both match. " +
    "Distinguish them with a literal, existence, or value split.",
  foldAtMostOne:
    'Former "the first reading of (circle)": the source already promises at most one row; use a plain line or whether(...), not a fold.',
  recordFanOut:
    'Former "the member card (circle)": this record\'s where may match many rows; wrap the source in each(...) when the result should contain rows.',
};

function buildBook() {
  return assemble({
    vocabulary: words,
    composition: {
      book: {
        ClearedReadingClosesDiscussion,
        theStandingOf,
        memberMayRespond,
        nonmemberMayNotRespond,
        HostLeavingDissolvesCircle,
        OpenDiscussionOnce,
        theOpenDiscussionOf,
        theCircleCard,
        theCurrentReadingOf,
        theResponseCountOf,
        AddResponse,
        RejectNonmemberResponse,
        LeavingRoutesByHost,
        ChooseReadingHostOnly,
        GetCircleName,
        theCircleActivityOf,
        theRespondedCircleActivityOf,
      },
    },
  });
}

async function bookText(): Promise<string> {
  return await readFile(new URL("../../docs/book.md", import.meta.url), "utf8");
}

describe("the example book", () => {
  test("the engine states every read-back the book quotes", async () => {
    const readBack = buildBook().engine.readBack();
    const book = await bookText();
    for (const pin of readBackPins) expect(readBack).toContain(pin);
    for (const pin of readBackPins) expect(book).toContain(pin);
  });

  test("every mistake the book shows is rejected in its exact words", async () => {
    const book = await bookText();
    const rejects = (entry: Record<string, unknown>) => () =>
      assemble({ vocabulary: words, composition: { bad: entry } });

    expect(rejects({ CloseTheAbsentDiscussion })).toThrow(errorPins.freshUnderNo);
    expect(rejects({ ReopenOnJoin })).toThrow(errorPins.unusedName);
    expect(rejects({ GetCircleNameFirstDraft })).toThrow(errorPins.noWitness);

    const app = buildBook();
    await expect(app.engine.form(theFirstReadingOf("after-dinner"))).rejects.toThrow(
      errorPins.foldAtMostOne,
    );
    await expect(app.engine.form(theMemberCard("after-dinner"))).rejects.toThrow(
      errorPins.recordFanOut,
    );

    for (const pin of Object.values(errorPins)) expect(book).toContain(pin);
  });

  test("a former returns no result when a plain read receives a blank value from whether", async () => {
    const app = buildBook();

    expect(await app.engine.form(theCircleActivityOf("after-dinner"))).toEqual({
      reading: null,
      discussion: null,
    });
    expect(await app.engine.form(theRespondedCircleActivityOf("after-dinner"))).toBeNull();

    const { selection } = await app.concepts.Selecting.choose({
      scope: "after-dinner",
      item: "The Dispossessed",
    });
    const [{ discussion }] = await app.concepts.Discussing._openFor({ subject: selection });

    expect(await app.engine.form(theCircleActivityOf("after-dinner"))).toEqual({
      reading: "The Dispossessed",
      discussion,
    });
    expect(await app.engine.form(theRespondedCircleActivityOf("after-dinner"))).toBeNull();

    await app.concepts.Discussing.respond({ discussion, author: "Lin", text: "A response." });
    expect(await app.engine.form(theRespondedCircleActivityOf("after-dinner"))).toEqual({
      reading: "The Dispossessed",
      discussion,
    });
  });
});
