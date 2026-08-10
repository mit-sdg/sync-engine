# Read construction cookbook

Compare these reading constructions with their close variants. [Execution
semantics](../reference/semantics.md#reading-declarations-govern) defines the
contract; the [language API](../reference/public-api.md#language) lists the
interfaces. `inspectAssembly(assemble(...)).readBack` returns diagnostic output
like the excerpts below, exposing opened names, tests, fan-out, and drop points.

A plain line is not ordered by its position in a reaction or former. The
engine schedules a line when its inputs are bound; the examples put supplying
lines first where that makes the data flow easier to read. Views are the
exception documented in the reference: write each view line after the line
that supplies its inputs.

**Invalid construction** entries include the exact rejection. Most fail during
assembly registration; former-root errors fail when installed for evaluation.

## Construction index

| Need                                     | Entry                                                                     |
| ---------------------------------------- | ------------------------------------------------------------------------- |
| Require one relation row                 | [A plain line](#1--a-plain-line)                                          |
| Depend on declared cardinality           | [Declared promises](#2--declared-promises)                                |
| Test a literal                           | [A literal in the pattern tests](#3--a-literal-in-the-pattern-tests)      |
| Reuse a bound name and fan out           | [A bound name tests](#4--a-bound-name-tests-and-a-many-relation-fans-out) |
| Require absence                          | [`no`](#5--no--denial)                                                    |
| Preserve a case on absence               | [`whether`](#6--whether--bind-or-blank)                                   |
| Read an output view                      | [A view with outputs](#7--a-view-with-outputs)                            |
| Make a formed record optional            | [An optional former](#8--a-former-that-may-decline--optional)             |
| Reduce selected rows                     | [Selection folds](#9--folds-consume-a-captured-range)                     |
| Read an endpoint end to end              | [A whole endpoint](#10--a-whole-endpoint-read-end-to-end)                 |
| Author sibling reaction paths            | [Ordinary siblings](#11--siblings-on-an-ordinary-reaction)                |
| Author sibling endpoint paths            | [Endpoint siblings](#12--an-endpoint-uses-the-same-sibling-shape)         |
| Preserve a record through optional reads | [Only `whether` lines](#13--a-body-of-only-whether-lines)                 |

## Error index

| Rejected attempt                        | Entry                                                         |
| --------------------------------------- | ------------------------------------------------------------- |
| Open a name that no later line uses     | [A plain line](#1--a-plain-line)                              |
| Open a fresh name inside `no(...)`      | [`no`](#5--no--denial)                                        |
| Fold a source promising at most one row | [An optional former](#8--a-former-that-may-decline--optional) |
| Form one record from a many-row source  | [Selection folds](#9--folds-consume-a-captured-range)         |

## The scene

The [reading-circle example](../../../examples/reading-circle/README.md)
supplies this vocabulary and its query promises:

| Concept    | Actions                    | Queries and their promises                                                                                                                        |
| ---------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gathering  | `create`, `join`, `leave`  | `_get (gathering) → name, host` at most one · `_members (gathering) → member` any number · `_membership (gathering, member) → joined` exactly one |
| Selecting  | `choose`, `clear`          | `_current (scope) → selection, item` at most one · `_get (selection) → scope, item` at most one                                                   |
| Discussing | `open`, `respond`, `close` | `_openFor (subject) → discussion` at most one · `_responses (discussion) → response, author, text` any number                                     |

The entries register in composition `book`, reflected in reaction read-backs.
Query promises belong to the vocabulary contract, not each use site.

## 1 · A plain line

_When a circle clears its reading, close the discussion that was open for it._

```ts
const ClearedReadingClosesDiscussion = reaction(({ selection, discussion }) =>
  when(Selecting.clear({}).responds({ selection }))
    .where(Discussing._openFor({ subject: selection }).is({ discussion }))
    .then(Discussing.close({ discussion })),
);
```

- **English**: the discussion open for that selection.
- **Runs**: `subject` is bound from the trigger, so the engine can read
  `_openFor` for that one subject.
- **None / many**: `_openFor` promises at most one row. None means the reaction
  quietly does not fire; the read needs no explicit absence operator because
  the declaration already permits no result. More than one row violates the
  promise; the resulting fault names the query, not this reaction.
- **Opens**: `discussion` — a fresh name in `.is` binds.

Registration read-back:

```
book.ClearedReadingClosesDiscussion
  when Selecting.clear — opens (selection)
  Discussing._openFor (subject: selection) has (discussion) — fills or drops the case; opens (discussion)
  then Discussing.close (discussion)
```

**Invalid construction — unused output.** This reaction opens both `_current`
outputs but uses only one:

```ts
const ReopenOnJoin = reaction(({ circle, selection, reading }) =>
  when(Gathering.join({ gathering: circle }).responds({}))
    .where(Selecting._current({ scope: circle }).is({ selection, item: reading }))
    .then(Discussing.open({ subject: selection })),
);
```

Registration rejects the unused opened name:

```
Reaction "bad.ReopenOnJoin": "reading" is opened and never used — omit the key instead.
```

## 2 · Declared promises

`_membership` promises exactly one row — every member-circle pair has a
standing. This line accepts that row and binds its `joined` field, so the line
cannot drop the case:

```ts
const theStandingOf = view(
  "the standing of (member) in (circle)",
  ({ member, circle }, { joined }, _bindings) =>
    where(Gathering._membership({ gathering: circle, member }).is({ joined })),
).one();
```

- **English**: whether this member has joined this circle.
- **Runs**: both inputs are bound; the engine reads the one promised row.
- **None / many**: neither can happen without an integrity fault. The view's
  own `one()` terminal carries that promise outward, and the engine checks it
  when the view is read.
- **Opens**: `joined`.

A `one` promise guarantees one source row, not that every output pattern will
match it. A literal or already-bound name in `.is(...)` can reject that row and
drop the case.

```
the standing of (member) in (circle) — inputs (member, circle); outputs (joined); bindings () — promises exactly one (joined); checked when read
  Gathering._membership (gathering: circle, member) has (joined) — always fills; opens (joined)
```

The relation's promise determines whether a read _always fills_, _fills or
drops_, or _fans out_; authors do not repeat it at the use site.

## 3 · A literal in the pattern tests

_May this member respond in this circle?_

```ts
const memberMayRespond = view(
  "(member) may respond in (circle)",
  ({ member, circle }, _outputs, _bindings) =>
    where(Gathering._membership({ gathering: circle, member }).is({ joined: true })),
).holds();

const nonmemberMayNotRespond = view(
  "(member) may not respond in (circle)",
  ({ member, circle }, _outputs, _bindings) =>
    where(Gathering._membership({ gathering: circle, member }).is({ joined: false })),
).holds();
```

- **English**: the member's standing says joined.
- **Runs**: the same one-row read as entry 2. The `joined: true` literal tests
  the row.
- **None / many**: the row always exists; the line holds or it does not. A
  view with no output tail is a predicate.
- **Opens**: nothing.

```
(member) may respond in (circle) — inputs (member, circle); outputs (); bindings () — a predicate: holds or not
  Gathering._membership (gathering: circle, member) has (joined: true) — existence — fires once or drops the case
```

Entry 10 uses the second view in its denial branch.

## 4 · A bound name tests, and a many-relation fans out

_When the host leaves a circle, every remaining member leaves too._

```ts
const HostLeavingDissolvesCircle = reaction(({ circle, host, member }) =>
  when(Gathering.leave({ gathering: circle, member: host }).responds({}))
    .where(
      Gathering._get({ gathering: circle }).is({ host }),
      Gathering._members({ gathering: circle }).is({ member }),
    )
    .then(Gathering.leave({ gathering: circle, member })),
);
```

- **English**: the leaver is the host; every member of the circle.
- **Runs**: `host` is already bound from the trigger, so the first line tests
  the circle's `host` field against it. Reusing the same variable in both
  patterns expresses equality. The second line reads a many-promise relation
  with a fresh name.
- **None / many**: if the leaver is not the host, the first line drops the
  case. The second line fires the consequence once per distinct member, as
  declared by `_members`.
- **Opens**: `member`.

```
book.HostLeavingDissolvesCircle
  when Gathering.leave — opens (circle, host)
  Gathering._get (gathering: circle) has (host) — existence — fires once or drops the case
  Gathering._members (gathering: circle) has (member) — fans out once per distinct fill; opens (member)
  then Gathering.leave (gathering: circle, member)
```

## 5 · `no` — denial

_When a circle chooses a reading, open a discussion — unless one is already
open._

```ts
const OpenDiscussionOnce = reaction(({ selection }) =>
  when(Selecting.choose({}).responds({ selection }))
    .where(no(Discussing._openFor({ subject: selection })))
    .then(Discussing.open({ subject: selection })),
);
```

- **English**: no discussion is open for it.
- **Runs**: the same read as entry 1, expecting emptiness.
- **None / many**: none passes; any row drops the case. `no` has one meaning:
  no such row exists at all, never "a row exists that differs."
- **Opens**: nothing. `no` can only test names already bound by the trigger or
  another available line.

```
book.OpenDiscussionOnce
  when Selecting.choose — opens (selection)
  no Discussing._openFor (subject: selection) — holds only when no such row exists — drops the case otherwise
  then Discussing.open (subject: selection)
```

**Invalid construction — asking the denial to hand something back.** An author
wanted "the discussion that is no longer open" and reached for `no` as if it
selected the missing row:

```ts
const CloseTheAbsentDiscussion = reaction(({ selection, discussion }) =>
  when(Selecting.clear({}).responds({ selection }))
    .where(no(Discussing._openFor({ subject: selection }).is({ discussion })))
    .then(Discussing.close({ discussion })),
);
```

There is no row under a `no` to bind from, so a fresh name there is refused:

```
Reaction "bad.CloseTheAbsentDiscussion": "discussion" is new inside no Discussing._openFor; no(...) can only test names bound by an earlier plain line.
```

## 6 · `whether` — bind or blank

_The circle card: name and host always, the current reading if there is one._

```ts
const theCircleCard = former("the circle card (circle)", ({ circle }, { name, host, reading }) =>
  where(
    Gathering._get({ gathering: circle }).is({ name, host }),
    whether(Selecting._current({ scope: circle }).is({ item: reading })),
  ).form({ name, host, reading }),
);
```

- **English**: the circle's name and host, and its current reading if any.
- **Runs**: the first line is plain and therefore required. The second is
  softened by `whether`, so its row is read only if present.
- **None / many**: without `whether`, an absent selection would drop the whole
  card, because that is how a plain line handles absence. With it, the card
  survives and `reading` comes through blank — a `null` leaf in the formed
  record.
- **Opens**: `name`, `host`, and `reading` (possibly blank). A possibly-blank
  name may shape output; a plain line using it as query input drops the
  case while it is blank, so a chain meant to survive absence stays under
  `whether`.

The engine checks the former's exactly-one promise when forming:

```
the circle card (circle) — inputs (circle); bindings (name, host, reading); promises exactly one; checked when formed
```

## 7 · A view with outputs

_Which discussion is this circle's current conversation?_

```ts
const theOpenDiscussionOf = view(
  "the open discussion of (circle)",
  ({ circle }, { discussion }, { selection }) =>
    where(
      Selecting._current({ scope: circle }).is({ selection }),
      Discussing._openFor({ subject: selection }).is({ discussion }),
    ),
).optional();
```

- **English**: the discussion open for the circle's current selection.
- **Runs**: two at-most-one reads chained through `selection`, which stays
  local to the view; callers see only the declared output.
- **None / many**: `optional()` declares at most one result, and the engine
  checks that promise whenever the view is read. A
  caller reading this view plainly drops its case when there is none; a caller
  wrapping it in `whether` gets a blank.
- **Opens**: at a use-site, whatever fresh names the caller puts in `.is` —
  the view is read exactly like a concept query.

```
the open discussion of (circle) — inputs (circle); outputs (discussion); bindings (selection) — promises at most one (discussion); checked when read
  Selecting._current (scope: circle) has (selection) — fills or drops the case; opens (selection)
  Discussing._openFor (subject: selection) has (discussion) — fills or drops the case; opens (discussion)
```

## 8 · A former that may decline — `optional()`

_The current reading, for a card that shows nothing when nothing is chosen._

```ts
const theCurrentReadingOf = former("the current reading of (circle)", ({ circle }, { reading }) =>
  where(Selecting._current({ scope: circle }).is({ item: reading })).form({ reading }),
).optional();
```

A record former promises exactly one answer unless it ends in `optional()`:

```
the current reading of (circle) — inputs (circle); bindings (reading); promises at most one; checked when formed
```

A plain use of this former drops its host row when there is no reading;
`whether(theCurrentReadingOf({ circle }))` keeps the host row and supplies
blank leaves. Absence is declared once, here; each use then chooses how to
handle it.

**Invalid construction — folding a single source.**

```ts
const theFirstReadingOf = former("the first reading of (circle)", ({ circle }, { reading }) =>
  each(Selecting._current({ scope: circle }).is({ item: reading })).first(reading),
);
```

```
Former "the first reading of (circle)": the source already promises at most one row; use a plain line or whether(...), not a fold.
```

Folds reduce pluralities; use the plain read above for an at-most-one source.
A fold changes result shape and cannot repair a query-promise violation.

## 9 · Folds consume a captured range

_How many responses does the discussion hold?_

```ts
const theResponseCountOf = former(
  "the response count of (discussion)",
  ({ discussion }, { response }) =>
    each(Discussing._responses({ discussion }).is({ response })).count(),
);
```

- **English**: the count of the discussion's responses.
- **Runs**: `each` captures every row of a many-promise read; `count` folds
  the capture to one number.
- **None / many**: an empty capture counts to zero. `count()` always produces a
  number, so this former promises exactly one.
- **Opens**: nothing outward; `response` ranges inside the capture.

```
the response count of (discussion) — inputs (discussion); bindings (response); promises exactly one; checked when formed
```

**Invalid construction — a record over a many-row source.**

```ts
const theMemberCard = former("the member card (circle)", ({ circle }, { member }) =>
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
      .then(Discussing.respond({ discussion, author: member, text }).responds({ response }))
      .then(respond({ response })),
);

const RejectNonmemberResponse = endpoint("/circles/respond", ({ circle, reading, member, text }) =>
  receive({ circle, reading, member, text })
    .where(nonmemberMayNotRespond({ member, circle }))
    .then(respond({ error: "NOT_A_MEMBER" })),
);
```

`Selecting._current` opens `selection` and tests `item` against the bound
`reading`. The view reads like a query. The response step and nonmember answer
are independent:

```
book.AddResponse
  when RequestBoundary.request — opens (circle, reading, member, text, requestId)
  view "(member) may respond in (circle)" with (member, circle) — existence — fires once or drops the case
  Selecting._current (scope: circle) has (selection, item: reading) — fills or drops the case; opens (selection); tests (item) — may drop the case
  Discussing._openFor (subject: selection) has (discussion) — fills or drops the case; opens (discussion)
  then Discussing.respond (discussion, author: member, text)
```

```
book.AddResponse#2
  when Discussing.respond — opens (discussion, member, text, response)
  earlier, RequestBoundary.request (circle, reading, member, text, requestId, path: "/circles/respond") — reads the flow's record, once per matching occurrence
  then RequestBoundary.respond (response, requestId)
```

```
book.RejectNonmemberResponse
  when RequestBoundary.request — opens (circle, reading, member, text, requestId)
  view "(member) may not respond in (circle)" with (member, circle) — existence — fires once or drops the case
  then RequestBoundary.respond (error: "NOT_A_MEMBER", requestId)
```

Declarations on one path are independent alternatives and may both fire. The
opposite views make no exclusivity or coverage claim. Entries 11 and 12 apply
the same all-match rule to siblings.

## 11 · Siblings on an ordinary reaction

_When someone leaves a circle with a current selection, handle the member and
host paths._

```ts
const LeavingRoutesByHost = reaction(({ circle, member }) =>
  when(Gathering.leave({ gathering: circle, member }).responds({}))
    .where(Selecting._current({ scope: circle }))
    .then(
      where(Gathering._get({ gathering: circle }).is.not({ host: member }))
        .then(Selecting.clear({ scope: circle }))
        .named("member"),
      where(Gathering._get({ gathering: circle }).is({ host: member }))
        .then(Discussing.open({ subject: circle }))
        .named("host"),
    ),
);
```

The `_current` line is a shared prefix: both branches require a selection.
Each branch then compares the same `host` field with `member`, one for
difference and one for equality. The language does not prove or depend on that
relationship. It evaluates both branches and runs every one that matches.

```
book.LeavingRoutesByHost:member
  when Gathering.leave — opens (circle, member)
  Selecting._current (scope: circle) — existence — fires once or drops the case
  Gathering._get (gathering: circle) and not (host: member) — existence — fires once or drops the case
  then Selecting.clear (scope: circle)
```

```
book.LeavingRoutesByHost:host
  when Gathering.leave — opens (circle, member)
  Selecting._current (scope: circle) — existence — fires once or drops the case
  Gathering._get (gathering: circle) has (host: member) — existence — fires once or drops the case
  then Discussing.open (subject: circle)
```

Each sibling lowers to a single-case reaction. Stable labels produce
`book.LeavingRoutesByHost:member` and `book.LeavingRoutesByHost:host` regardless
of source order. Both matching paths run; if the shared selection or both branch
reads drop, neither runs.

## 12 · An endpoint uses the same sibling shape

_Only the host may choose the circle's reading._

```ts
const ChooseReadingHostOnly = endpoint(
  "/circles/choose",
  ({ circle, member, reading, selection }) =>
    receive({ circle, member, reading }).then(
      where(Gathering._get({ gathering: circle }).is.not({ host: member }))
        .then(respond({ error: "HOST_ONLY" }))
        .named("non-host"),
      where(Gathering._get({ gathering: circle }).is({ host: member }))
        .then(Selecting.choose({ scope: circle, item: reading }).responds({ selection }))
        .then(respond({ selection }))
        .named("host"),
    ),
);
```

- **English**: if the requester is not the host, answer with `HOST_ONLY`; if
  the requester is the host, choose.
- **Runs**: both sibling conditions are evaluated. Reusing the bound name
  tests equality, while `.is.not` tests difference. Every matching branch
  starts; labels establish path names, not priority.
- **None / many**: `_get` promises at most one row, so when the circle does
  not exist _both_ cases drop and neither branch responds.
- **Opens**: `selection`, in the acting case only.

`receive(...)` supplies an outside-request trigger; the endpoint adds the path,
input contract, request correlation, response, and generated wire.

```
book.ChooseReadingHostOnly:non-host
  when RequestBoundary.request — opens (circle, member, reading, requestId)
  Gathering._get (gathering: circle) and not (host: member) — existence — fires once or drops the case
  then RequestBoundary.respond (error: "HOST_ONLY", requestId)
```

```
book.ChooseReadingHostOnly:host
  when RequestBoundary.request — opens (circle, member, reading, requestId)
  Gathering._get (gathering: circle) has (host: member) — existence — fires once or drops the case
  then Selecting.choose (scope: circle, item: reading)
```

```
book.ChooseReadingHostOnly:host#2
  when Selecting.choose — opens (circle, reading, selection)
  earlier, RequestBoundary.request (circle, member, reading, requestId, path: "/circles/choose") — reads the flow's record, once per matching occurrence
  then RequestBoundary.respond (selection, requestId)
```

**Overlapping conditions.** The second branch intends "not found" but uses a
plain read, so a found circle makes both branches answer:

```ts
const GetCircleNameFirstDraft = endpoint("/circles/name", ({ circle, name }) =>
  receive({ circle }).then(
    where(Gathering._get({ gathering: circle }).is({ name }))
      .then(respond({ name }))
      .named("found"),
    where(Gathering._get({ gathering: circle }))
      .then(respond({ error: "NO_SUCH_CIRCLE" }))
      .named("missing"),
  ),
);
```

The boundary accepts one answer and refuses the other with `NOT_PENDING`.
Source order and labels choose no winner. The intended spelling says the
absence directly:

```ts
const GetCircleName = endpoint("/circles/name", ({ circle, name }) =>
  receive({ circle }).then(
    where(Gathering._get({ gathering: circle }).is({ name }))
      .then(respond({ name }))
      .named("found"),
    where(no(Gathering._get({ gathering: circle })))
      .then(respond({ error: "NO_SUCH_CIRCLE" }))
      .named("missing"),
  ),
);
```

Runtime does not enforce this found/missing coverage. Diagnostics report that
neither path is independently total, and the reads do not share a state
snapshot.

```
book.GetCircleName:found
  when RequestBoundary.request — opens (circle, requestId)
  Gathering._get (gathering: circle) has (name) — fills or drops the case; opens (name)
  then RequestBoundary.respond (name, requestId)
```

```
book.GetCircleName:missing
  when RequestBoundary.request — opens (circle, requestId)
  no Gathering._get (gathering: circle) — holds only when no such row exists — drops the case otherwise
  then RequestBoundary.respond (error: "NO_SUCH_CIRCLE", requestId)
```

## 13 · A body of only `whether` lines

_The circle at a glance: the current reading if one is chosen, the open
discussion if there is one — and an answer either way._

Unlike entry 6, this former has no required plain-line anchor:

```ts
const theCircleActivityOf = former(
  "the circle activity of (circle)",
  ({ circle }, { selection, reading, discussion }) =>
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
- **None / many**: the record-root former promises exactly one. A `whether`
  line never drops a case, so this construction answers with one record,
  possibly with every leaf blank. The engine checks the declared promise when
  it forms the answer.
- **Opens**: `selection`, `reading`, and `discussion`, all possibly blank.
  `selection` is a local binding consumed by `_openFor`; only `reading` and
  `discussion` appear in the formed output.

```
the circle activity of (circle) — inputs (circle); bindings (selection, reading, discussion); promises exactly one; checked when formed
```

Nothing in this body tests that the circle exists, so an unknown circle returns
a record of blanks. To return absence, anchor the body with one plain line
(entry 6), or make a plain-read former optional (entry 8).

Adding a plain `_responses` read requires at least one response:

```ts
const theRespondedCircleActivityOf = former(
  "the responded circle activity of (circle)",
  ({ circle }, { selection, reading, discussion }) =>
    where(
      whether(Selecting._current({ scope: circle }).is({ selection, item: reading })),
      whether(Discussing._openFor({ subject: selection }).is({ discussion })),
      Discussing._responses({ discussion }),
    ).form({ reading, discussion }),
).optional();
```

Without `_current`, `selection` is blank, `_openFor` is skipped, and the plain
`_responses` read makes the former return `null`. With a current selection and
open discussion, the former returns its record only if a response exists.

```
the responded circle activity of (circle) — inputs (circle); bindings (selection, reading, discussion); promises at most one; checked when formed
```

## Related references

See [Execution semantics](../reference/semantics.md) for cache freshness,
equality, failure delivery, concurrency, retention, and cancellation. [Getting
started](getting-started.md) builds a complete application.
