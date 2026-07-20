# The example book

Use this book to look up a reading construction and see it in a small working
example. The [documentation router](./README.md) points to the right guide or
reference for each task, and the [guided walkthrough](./guide/getting-started.md)
builds a complete application.

For your own assembly, `inspectAssembly(assemble(...)).readBack` returns the
same kind of read-back shown here.

Each entry describes four parts of the construction:

1. What is the **English**?
2. What **runs**, and why was it forced?
3. What happens on **none**, and on **many**?
4. Which names did the line **open**?

Entries marked ☒ show an invalid construction beside its registration error.

## The scene

Everything below reads against the
[reading-circle example](../examples/reading-circle/README.md)'s own
vocabulary — the entries import it rather than restate it: people gather in
circles, a circle selects a current reading, and an open discussion collects
responses. Their queries declare every promise the entries lean on:

| Concept    | Actions                    | Queries and their promises                                                                                                                        |
| ---------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gathering  | `create`, `join`, `leave`  | `_get (gathering) → name, host` at most one · `_members (gathering) → member` any number · `_membership (gathering, member) → joined` exactly one |
| Selecting  | `choose`, `clear`          | `_current (scope) → selection, item` at most one · `_get (selection) → scope, item` at most one                                                   |
| Discussing | `open`, `respond`, `close` | `_openFor (subject) → discussion` at most one · `_responses (discussion) → response, author, text` any number                                     |

The entries register as one composition named `book`, so reactions print under
`book.` in the read-backs quoted below.

## 1 · A plain line

_When a circle clears its reading, close the discussion that was open for it._

```ts
const ClearedReadingClosesDiscussion = reaction(({ selection, discussion }) =>
  when(Selecting.clear, {}, { selection })
    .where(Discussing._openFor({ subject: selection }).is({ discussion }))
    .then(request(Discussing.close, { discussion })),
);
```

- **English**: the discussion open for that selection.
- **Runs**: `subject` is bound from the trigger, so the engine reads
  `_openFor` for that one subject. Nothing else could run: the only bound name
  appears in the query input.
- **None / many**: `_openFor` promises at most one row. None means the reaction
  quietly does not fire — no word for that was written, because the
  declaration already says it. Many cannot happen; if the concept ever broke
  that promise, the fault would name the query, not this reaction.
- **Opens**: `discussion` — a fresh name in `.is` binds.

The engine states this back at registration:

```
book.ClearedReadingClosesDiscussion
  when Selecting.clear — opens (selection)
  Discussing._openFor (subject: selection) has (discussion) — fills or drops the case; opens (discussion)
  then request Discussing.close (discussion)
```

**☒ Caught mistake — the row grabbed out of habit.** A later reaction pulled
both outputs of `_current` and used only one:

```ts
const ReopenOnJoin = reaction(({ circle, selection, reading }) =>
  when(Gathering.join, { gathering: circle }, {})
    .where(Selecting._current({ scope: circle }).is({ selection, item: reading }))
    .then(request(Discussing.open, { subject: selection })),
);
```

Opening a name is a claim that the reaction ranges over it, so an opened name
nobody reads is refused:

```
Reaction "bad.ReopenOnJoin": "reading" is opened and never used — omit the key instead.
```

## 2 · The promise decides, not the words

`_membership` promises exactly one row — every member-circle pair has a
standing — so a line reading it can never drop anything:

```ts
const theStandingOf = view(
  "the standing of (member) in (circle) with one (joined)",
  ({ member, circle, joined }) =>
    where(Gathering._membership({ gathering: circle, member }).is({ joined })),
);
```

- **English**: whether this member has joined this circle.
- **Runs**: both inputs are bound; the engine reads the one promised row.
- **None / many**: neither can happen — the promise is `one`, and the view's
  own tail (`with one (joined)`) carries that promise outward, proven at
  registration.
- **Opens**: `joined`.

```
the standing of (member) in (circle) — promises exactly one (joined); the body proves it
  Gathering._membership (gathering: circle, member) has (joined) — always fills; opens (joined)
```

Entries 1 and 2 show the cardinality contract. Authors do not repeat a quantity
at the use-site. The relation's promise decides between _always fills_, _fills
or drops_, and _fans out_.

## 3 · A literal in the pattern tests

_May this member respond in this circle?_

```ts
const memberMayRespond = view("(member) may respond in (circle)", ({ member, circle }) =>
  where(Gathering._membership({ gathering: circle, member }).is({ joined: true })),
);

const nonmemberMayNotRespond = view("(member) may not respond in (circle)", ({ member, circle }) =>
  where(Gathering._membership({ gathering: circle, member }).is({ joined: false })),
);
```

- **English**: the member's standing says joined.
- **Runs**: the same one-row read as entry 2, but `joined: true` is a literal,
  so the row is tested instead of opened.
- **None / many**: the row always exists; the line holds or it does not. A
  view with no output tail is a predicate.
- **Opens**: nothing.

```
(member) may respond in (circle) — a predicate: holds or not
  Gathering._membership (gathering: circle, member) has (joined: true) — existence — fires once or drops the case
```

The second view is a deliberate twin, not a leftover: the pair partitions the
answer so that each boundary arm in entry 10 can ask its own question.

## 4 · A bound name tests, and a many-relation fans out

_When the host leaves a circle, every remaining member leaves too._

```ts
const HostLeavingDissolvesCircle = reaction(({ circle, host, member }) =>
  when(Gathering.leave, { gathering: circle, member: host }, {})
    .where(
      Gathering._get({ gathering: circle }).is({ host }),
      Gathering._members({ gathering: circle }).is({ member }),
    )
    .then(request(Gathering.leave, { gathering: circle, member })),
);
```

- **English**: the leaver is the host; every member of the circle.
- **Runs**: `host` is already bound from the trigger, so the first line tests
  the circle's `host` field against it — equality is never a word, it is the
  same variable in both output patterns. The second line reads a many-promise relation with a
  fresh name.
- **None / many**: if the leaver is not the host, the first line drops the
  case. The second line fires the consequence once per distinct member — the
  fan-out was declared by `_members`, not written here.
- **Opens**: `member`.

```
book.HostLeavingDissolvesCircle
  when Gathering.leave — opens (circle, host)
  Gathering._get (gathering: circle) has (host) — existence — fires once or drops the case
  Gathering._members (gathering: circle) has (member) — fans out once per distinct fill; opens (member)
  then request Gathering.leave (gathering: circle, member)
```

## 5 · `no` — denial

_When a circle chooses a reading, open a discussion — unless one is already
open._

```ts
const OpenDiscussionOnce = reaction(({ selection }) =>
  when(Selecting.choose, {}, { selection })
    .where(no(Discussing._openFor({ subject: selection })))
    .then(request(Discussing.open, { subject: selection })),
);
```

- **English**: no discussion is open for it.
- **Runs**: the same read as entry 1, expecting emptiness.
- **None / many**: none passes; any row drops the case. `no` has exactly one
  reading — no such row exists at all — never "a row exists that differs."
- **Opens**: nothing. `no` can only test names bound by an earlier plain line.

```
book.OpenDiscussionOnce
  when Selecting.choose — opens (selection)
  no Discussing._openFor (subject: selection) — holds only when no such row exists — drops the case otherwise
  then request Discussing.open (subject: selection)
```

**☒ Caught mistake — asking the denial to hand something back.** An author
wanted "the discussion that is no longer open" and reached for `no` as if it
selected the missing row:

```ts
const CloseTheAbsentDiscussion = reaction(({ selection, discussion }) =>
  when(Selecting.clear, {}, { selection })
    .where(no(Discussing._openFor({ subject: selection }).is({ discussion })))
    .then(request(Discussing.close, { discussion })),
);
```

There is no row under a `no` to bind from, so a fresh name there is refused:

```
Reaction "bad.CloseTheAbsentDiscussion": "discussion" is new inside no Discussing._openFor; no(...) can only test names bound by an earlier plain line.
```

## 6 · `whether` — bind or blank

_The circle card: name and host always, the current reading if there is one._

```ts
const theCircleCard = former("the circle card (circle)", ({ circle, name, host, reading }) =>
  where(
    Gathering._get({ gathering: circle }).is({ name, host }),
    whether(Selecting._current({ scope: circle }).is({ item: reading })),
  ).form({ name, host, reading }),
);
```

- **English**: the circle's name and host, and its current reading if any.
- **Runs**: the first line reads as always; the second is softened by
  `whether` — the row is read if present.
- **None / many**: without `whether`, an absent selection would drop the whole
  card, because that is how a plain line handles absence. With it, the card
  survives and `reading` comes through blank — a `null` leaf in the formed
  record.
- **Opens**: `name`, `host`, and `reading` (possibly blank). A possibly-blank
  name may shape output; a plain line using it as query input drops the
  case while it is blank, so a chain meant to survive absence stays under
  `whether`.

The former's read-back also shows a promise being enforced rather than proven:
`_get` promises at most one, so the body proves at most one card — but an
unmarked former sentence promises exactly one. The author declares that the
circle exists, and the engine checks that declaration at runtime:

```
the circle card (circle) — promises exactly one; the body proves at most one — the declaration is enforced at run
```

## 7 · A view with outputs

_Which discussion is this circle's current conversation?_

```ts
const theOpenDiscussionOf = view(
  "the open discussion of (circle) with optional (discussion)",
  ({ circle, selection, discussion }) =>
    where(
      Selecting._current({ scope: circle }).is({ selection }),
      Discussing._openFor({ subject: selection }).is({ discussion }),
    ),
);
```

- **English**: the discussion open for the circle's current selection.
- **Runs**: two at-most-one reads chained through `selection`, which stays
  local to the view; callers see only the declared output.
- **None / many**: a chain of at-most-one links proves at most one result, and
  registration checks that proof against the declared `with optional` tail. A
  caller reading this view plainly drops its case when there is none; a caller
  wrapping it in `whether` gets a blank.
- **Opens**: at a use-site, whatever fresh names the caller puts in `.is` —
  the view is read exactly like a concept query.

```
the open discussion of (circle) — promises at most one (discussion); the body proves it
  Selecting._current (scope: circle) has (selection) — fills or drops the case; opens (selection)
  Discussing._openFor (subject: selection) has (discussion) — fills or drops the case; opens (discussion)
```

## 8 · A former that may decline — `, if any`

_The current reading, for a card that shows nothing when nothing is chosen._

```ts
const theCurrentReadingOf = former(
  "the current reading of (circle), if any",
  ({ circle, reading }) =>
    where(Selecting._current({ scope: circle }).is({ item: reading })).form({ reading }),
);
```

An unmarked former sentence promises exactly one answer; ending the sentence
with `, if any` promises at most one. Here the body proves it outright:

```
the current reading of (circle) — promises at most one; the body proves it
```

A host that reads this former plainly drops its row when there is no reading;
a host that writes `whether(theCurrentReadingOf(circle))` keeps the row and
takes blank leaves. Absence is declared once, here — every reader then chooses
how to handle it.

**☒ Caught mistake — folding what is already single.** The first draft reached
for a fold to say "the first one":

```ts
const theFirstReadingOf = former("the first reading of (circle)", ({ circle, reading }) =>
  each(Selecting._current({ scope: circle }).is({ item: reading })).first(reading),
);
```

```
Former "the first reading of (circle)": the source already promises at most one row; use a plain line or whether(...), not a fold.
```

Folds reduce genuine pluralities. When the declaration already answers "how
many," the fold is refused, and the plain read above is the accepted spelling.

## 9 · Folds consume a captured range

_How many responses does the discussion hold?_

```ts
const theResponseCountOf = former(
  "the response count of (discussion)",
  ({ discussion, response }) =>
    each(Discussing._responses({ discussion }).is({ response })).count(),
);
```

- **English**: the count of the discussion's responses.
- **Runs**: `each` captures every row of a many-promise read; `count` folds
  the capture to one number.
- **None / many**: an empty capture counts to zero — a selection always
  answers, so this former promises exactly one.
- **Opens**: nothing outward; `response` ranges inside the capture.

```
the response count of (discussion) — promises exactly one; the body proves it
```

**☒ Caught mistake — a record over a crowd.** Without `each`, a formed record
was pointed at the many-promise relation directly:

```ts
const theMemberCard = former("the member card (circle)", ({ circle, member }) =>
  where(Gathering._members({ gathering: circle }).is({ member })).form({ member }),
);
```

```
Former "the member card (circle)": this record's where may match many rows; wrap the source in each(...) when the result should contain rows.
```

A record's `where` matches one case. Use `each` when the result needs rows:
`each(Gathering._members({ gathering: circle }).is({ member })).form({ member })`.

## 10 · A whole endpoint, read end to end

_Add a response: the member must be in the circle, the reading named in the
request must be the current one, and there must be an open discussion._

```ts
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
```

The middle line does two things at once, each already shown above: it opens
`selection`, and it tests `item` against the request's `reading` — the same
variable in both output patterns. The view line is read exactly like a query.
The read-backs show the successful arm, its response step, and the independent
nonmember answer:

```
book.AddResponse
  when RequestBoundary.request — opens (circle, reading, member, text, requestId)
  member may respond in circle — existence — fires once or drops the case
  Selecting._current (scope: circle) has (selection, item: reading) — fills or drops the case; opens (selection); tests (item) — may drop the case
  Discussing._openFor (subject: selection) has (discussion) — fills or drops the case; opens (discussion)
  then request Discussing.respond (discussion, author: member, text)
```

```
book.AddResponse#2
  when Discussing.respond — opens (discussion, member, text, response)
  earlier, RequestBoundary.request (circle, reading, member, text, requestId, path: "/circles/respond") — reads the flow's record, once per matching occurrence
  then request RequestBoundary.respond (response, requestId)
```

```
book.RejectNonmemberResponse
  when RequestBoundary.request — opens (circle, reading, member, text, requestId)
  member may not respond in circle — existence — fires once or drops the case
  then request RequestBoundary.respond (error: "NOT_A_MEMBER", requestId)
```

Two arms on one path are independent alternatives, and either may fire. The
twin views from entry 3 make these arms disjoint, but the endpoint declarations
do not claim that fact. Entries 11 and 12 show how to declare and check a
partition for an ordinary reaction and at the boundary.

## 11 · `either` on an ordinary reaction

_When someone leaves a circle with a current selection, handle a member and
the host as two exclusive cases._

```ts
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
```

The `_current` line is a shared prefix: both cases require a selection, and a
nested `either` would inherit its parent's conditions in the same way. The two
cases then compare the same at-most-one `host` field with `member`, one for
difference and one for equality. That value split is the witness registration
uses to prove that the cases cannot both hold.

```
book.LeavingRoutesByHost
  when Gathering.leave — opens (circle, member)
  Selecting._current (scope: circle) — existence — fires once or drops the case
  Gathering._get (gathering: circle) and not (host: member) — existence — fires once or drops the case
  then request Selecting.clear (scope: circle)
  assumes Selecting._current fills
  assumes Gathering._get fills
```

```
book.LeavingRoutesByHost:2
  when Gathering.leave — opens (circle, member)
  Selecting._current (scope: circle) — existence — fires once or drops the case
  Gathering._get (gathering: circle) has (host: member) — existence — fires once or drops the case
  then request Discussing.open (subject: circle)
  assumes Selecting._current fills
  assumes Gathering._get fills
```

An authored partition still runs as single-case reactions. The first leaf is
`book.LeavingRoutesByHost`; the second is
`book.LeavingRoutesByHost:2`. Independent alternatives that may both hold stay
as separate declarations like entry 10. An `either` with no witness is refused
rather than treated as an unchecked `or`. The assumptions say what the proof
does not: neither the shared selection read nor the circle read is proven to
fill, so both cases may still decline together.

## 12 · An endpoint uses the same partition

_Only the host may choose the circle's reading._

```ts
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
```

- **English**: if the requester is not the host, answer with `HOST_ONLY`; if
  the requester is the host, choose.
- **Runs**: registration proves the two cases disjoint before accepting the
  declaration — here from `.is({ host: member })` against
  `.is.not({ host: member })` on the same output field. Reusing the bound name
  tests equality, `.is.not` tests difference, and `no` tests that no row
  exists.
- **None / many**: `_get` promises at most one row, so when the circle does
  not exist _both_ cases drop and nobody answers. The engine does not hide
  that hole — it prints the assumption with each case.
- **Opens**: `selection`, in the acting case only.

`receive(...)` supplies an outside-request trigger to the same builder that
entry 11 used after `when(...)`. The partition proof and lowering are the same.
The endpoint layer adds the path, input contract, request correlation,
response, and generated wire.

```
book.ChooseReadingHostOnly
  when RequestBoundary.request — opens (circle, member, reading, requestId)
  Gathering._get (gathering: circle) and not (host: member) — existence — fires once or drops the case
  then request RequestBoundary.respond (error: "HOST_ONLY", requestId)
  assumes Gathering._get fills
```

```
book.ChooseReadingHostOnly:2
  when RequestBoundary.request — opens (circle, member, reading, requestId)
  Gathering._get (gathering: circle) has (host: member) — existence — fires once or drops the case
  then request Selecting.choose (scope: circle, item: reading)
  assumes Gathering._get fills
```

```
book.ChooseReadingHostOnly:2#2
  when Selecting.choose — opens (circle, reading, selection)
  earlier, RequestBoundary.request (circle, member, reading, requestId, path: "/circles/choose") — reads the flow's record, once per matching occurrence
  then request RequestBoundary.respond (selection, requestId)
  assumes Gathering._get fills
```

**☒ Caught mistake — a partition split by intent, not by form.** The author
meant the second case as "not found" but wrote it as a plain read — which
fires exactly when the circle _is_ found, overlapping the first case:

```ts
const GetCircleNameFirstDraft = endpoint("/circles/name", ({ circle, name }) =>
  receive({ circle }).either(
    where(Gathering._get({ gathering: circle }).is({ name })).then(respond({ name })),
    where(Gathering._get({ gathering: circle })).then(respond({ error: "NO_SUCH_CIRCLE" })),
  ),
);
```

```
either(...): cases 1 and 2 can both match. Distinguish them with a literal, existence, or value split.
```

The accepted spelling says the absence it means, and existence against denial
is a witness the proof accepts:

```ts
const GetCircleName = endpoint("/circles/name", ({ circle, name }) =>
  receive({ circle }).either(
    where(Gathering._get({ gathering: circle }).is({ name })).then(respond({ name })),
    where(no(Gathering._get({ gathering: circle }))).then(respond({ error: "NO_SUCH_CIRCLE" })),
  ),
);
```

This version also closes the printed hole above: one case now answers whenever
the other drops.

```
book.GetCircleName
  when RequestBoundary.request — opens (circle, requestId)
  Gathering._get (gathering: circle) has (name) — fills or drops the case; opens (name)
  then request RequestBoundary.respond (name, requestId)
```

```
book.GetCircleName:2
  when RequestBoundary.request — opens (circle, requestId)
  no Gathering._get (gathering: circle) — holds only when no such row exists — drops the case otherwise
  then request RequestBoundary.respond (error: "NO_SUCH_CIRCLE", requestId)
```

## 13 · A body of only `whether` lines

_The circle at a glance: the current reading if one is chosen, the open
discussion if there is one — and an answer either way._

Entry 6's card anchored on a plain line: `_get` had to fill, or there was no
card. Take the anchor away and soften every line:

```ts
const theCircleActivityOf = former(
  "the circle activity of (circle)",
  ({ circle, selection, reading, discussion }) =>
    where(
      whether(Selecting._current({ scope: circle }).is({ selection, item: reading })),
      whether(Discussing._openFor({ subject: selection }).is({ discussion })),
    ).form({ reading, discussion }),
);
```

- **English**: whatever the circle shows right now, each part if any.
- **Runs**: `whether(_current(...))` gives `selection` and `reading` values
  when the query returns a row, and gives neither value when it returns no
  row. A present `selection` is passed to `_openFor` as its `subject`. If
  either query returns no row, the former still returns one record, with the
  missing fields set to `null`.
- **None / many**: an unmarked former sentence promises exactly one, and this
  body proves it outright: a `whether` line never drops a case, so there is
  always exactly one answer — possibly with every leaf blank. Entry 6 made
  the same promise and needed a runtime cardinality check; this one does not.
- **Opens**: `reading` and `discussion`, both possibly blank.

```
the circle activity of (circle) — promises exactly one; the body proves it
```

The proof cuts both ways. Nothing in this body tests that the circle exists,
so asking about a circle nobody created still answers — a record of blanks,
not absence. When blanks are not what you mean, the earlier entries are the
choices: anchor the body with one plain line (entry 6), or promise `, if any`
over a plain read and let the case drop (entry 8).

This variant adds a plain `_responses` read. It returns a record only when the
open discussion has at least one response:

```ts
const theRespondedCircleActivityOf = former(
  "the responded circle activity of (circle), if any",
  ({ circle, selection, reading, discussion }) =>
    where(
      whether(Selecting._current({ scope: circle }).is({ selection, item: reading })),
      whether(Discussing._openFor({ subject: selection }).is({ discussion })),
      Discussing._responses({ discussion }),
    ).form({ reading, discussion }),
);
```

When `_current` returns no row, `selection` has no value. `_openFor` therefore
produces no `discussion`, and the plain `_responses` read causes the former to
return `null`. When both queries return a row, `_responses` receives the
`discussion` value and the former returns its record once a response exists.

```
the responded circle activity of (circle) — promises at most one; the body proves it
```

## Summary

Authors write plain lines and explicit result shapes. Relation declarations
supply cardinality, and the generated read-back reports opens, tests, fan-out,
dropped cases, and coverage assumptions. Registration rejects constructions
whose bindings, promises, or partitions cannot be checked. The examples above
show the accepted form beside each rejection.

Continue with [Execution semantics](./semantics.md) for the complete rules
behind these examples, or use the [guided walkthrough](./guide/getting-started.md)
to build and run an application.
