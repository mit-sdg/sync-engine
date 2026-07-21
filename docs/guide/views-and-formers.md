# Views and formers

Independent membership, selection, discussion, and alert behavior leave two
questions for the operations room:

- Who may contribute to this room?
- What should a responder receive when opening it?

A **view** gives the first question a name and a yes-or-no answer. A **former**
names the second question and returns the whole answer as one tree. Both live in
the composition, where they can read several concepts without teaching those
concepts about one another.

## Name the policy

The first policy admits anyone who belongs to the gathering. Its negative view
answers the other case explicitly.

_Source: [`examples/operations-room/src/composition/responders-may-contribute.ts`](../../examples/operations-room/src/composition/responders-may-contribute.ts)_

```ts
export const responderMayContribute = view(
  "(responder) may contribute in (room)",
  ({ responder, room }, _outputs, _bindings) =>
    where(Gathering._membership({ gathering: room, member: responder }).is({ joined: true })),
).holds();

export const responderMayNotContribute = view(
  "(responder) may not contribute in (room)",
  ({ responder, room }, _outputs, _bindings) =>
    where(Gathering._membership({ gathering: room, member: responder }).is({ joined: false })),
).holds();
```

The membership line tests its `joined` output against a literal. The first
view holds when the row says `true`; the second holds when it says `false`.
Neither line opens a name, and a caller supplies only `responder` and `room`.

The contribution boundary accepts the two views as its policy. The affirmative
view admits the success case; the negative view supplies the explicit denial.
The success case then follows the current selection to its open discussion.
Changing the policy does not copy or edit that request chain. The [application
boundary chapter](application-boundary.md#receive-ask-respond) teaches the
endpoint frame that consumes these views.

The negative view matters because both boundary cases share one path. For an
existing room, the two views answer opposite permission states: one case keeps
a permitted responder, and the other returns an explicit denial. The success
case still requires a current selection and an open discussion.

## Change the answer, not the concepts

A second policy keeps the same two questions and answers them from the room's
host instead of its membership.

_Source: [`examples/operations-room/src/composition/host-may-contribute.ts`](../../examples/operations-room/src/composition/host-may-contribute.ts)_

```ts
export const responderMayContribute = view(
  "(responder) may contribute in (room)",
  ({ responder, room }, _outputs, _bindings) =>
    where(Gathering._get({ gathering: room }).is({ host: responder })),
).holds();

export const responderMayNotContribute = view(
  "(responder) may not contribute in (room)",
  ({ responder, room }, _outputs, _bindings) =>
    where(Gathering._get({ gathering: room }).is.not({ host: responder })),
).holds();
```

Assemble with the responder policy and Lin's contribution returns a response.
Assemble again with the host policy and the same input returns `HOST_ONLY`.
The contribution boundary declarations and all four concept classes stay
unchanged.

## Build the read in stages

A former begins with the reads needed to fill one form. `where(...)` opens the
record's fields; `each(...).form(...)` captures every row for a list. The first
former promises one roster and captures every responder.

_Source: [`examples/operations-room/src/composition/room.ts`](../../examples/operations-room/src/composition/room.ts)_

```ts
export const responderRoster = former("the responder roster of (room)", ({ room }, { responder }) =>
  form({
    responders: each(Gathering._members({ gathering: room }).is({ member: responder })).form({
      responder,
    }),
  }),
);
```

The input bag makes `room` the callable former's one named input.
`responders` uses `each(Gathering._members(...)).form(...)` to return every
member row in the query's declared order. An empty room still has one roster,
with an empty `responders` array.

The next former asks for one current mitigation. Its record-root form promises
one formed value.

_Source: [`examples/operations-room/src/composition/room.ts`](../../examples/operations-room/src/composition/room.ts)_

```ts
export const requiredCurrentMitigation = former(
  "the required current mitigation (room)",
  ({ room }, { mitigation }) =>
    where(Selecting._current({ scope: room }).is({ item: mitigation })).form({ room, mitigation }),
);
```

Before the room chooses a mitigation, that read fails with `FORMER_NONE`. End
the former in `optional()` and the whole formed value is absent instead.

_Source: [`examples/operations-room/src/composition/room.ts`](../../examples/operations-room/src/composition/room.ts)_

```ts
export const currentMitigation = former(
  "the current mitigation (room)",
  ({ room }, { mitigation }) =>
    where(Selecting._current({ scope: room }).is({ item: mitigation })).form({ room, mitigation }),
).optional();
```

After a selection, both versions return the chosen mitigation. The difference
appears only when the query finds no row, so the former makes absence a local,
visible choice.

The human name is inert prose. The input and free-binding bags declare the
call shape, the formed tree declares the output shape, and `optional()` alone
weakens the record-root promise. Words such as `if any` in a name carry no
runtime meaning.

The source declaration governs matching. A plain line continues once per
distinct match or drops the candidate when none remain;
`whether(optionalLine)` keeps the candidate when the row is absent and leaves
its fresh names blank. Use `each(line)` when a former needs every row. At the
production site, choose whether to form those rows or reduce them with a fold.

The [public API's selection table](../public-surface.md#language) names each
callable consumer, its result for matches, and its empty-selection value.

A fold over a source that promises at most one row is rejected because the
source declaration already limits the result. The
[execution semantics](../semantics.md#views-and-formers) own the complete
cardinality and absence rules.

## Fold a selection

A former can fold a captured selection instead of carrying its rows. This
operations-room former uses all three folds. `count()` counts responses,
`first(response)` reads the first response in the query's declared order, and
`distinct(responder)` keeps each responder once in first-seen order.

_Source: [`examples/operations-room/src/composition/room.ts`](../../examples/operations-room/src/composition/room.ts)_

```ts
export const responseStats = former(
  "the response stats of (discussion)",
  ({ discussion }, { response, responder }) =>
    form({
      responseCount: each(
        Discussing._responses({ discussion }).is({ response, author: responder }),
      ).count(),
      firstResponse: each(
        Discussing._responses({ discussion }).is({ response, author: responder }),
      ).first(response),
      responders: each(
        Discussing._responses({ discussion }).is({ response, author: responder }),
      ).distinct(responder),
    }),
);
```

For an empty selection, `count()` returns `0`, `first(...)` returns `null`, and
`distinct(...)` returns `[]`. A view may count a query with
`count(query, input, n)`, which binds `n` even when the count is `0`; a later
closed comparison such as `is.lt(n, limit)` can test it. `first` and
`distinct` belong only to former production.

## Merge a reusable fragment

A fragment is a former whose open slot is filled by another former. The
responder roster above owns the `responders` shape. The room summary fills its
`room` slot from the host former's slot and merges the roster beside the room,
name, and host.

_Source: [`examples/operations-room/src/composition/room.ts`](../../examples/operations-room/src/composition/room.ts)_

```ts
export const roomSummary = former("the room summary (room)", ({ room }, { name, host }) =>
  where(Gathering._get({ gathering: room }).is({ name, host }))
    .form({ room, name, host })
    .splicing(responderRoster({ room })),
);
```

The roster promises one result, so the summary reads it plainly. An optional
fragment can instead be wrapped in `whether(...)`; absence then preserves the
host row and fills the merged leaves with `null`. A plain optional fragment
drops the host row when absent. Several fragment rows violate the fragment's
promise and raise a fault. Only a record-rooted fragment can be merged, and
its keys must not collide with the host.

## Form the complete dashboard

The dashboard needs facts from every concept: room details, responders, the
current mitigation, its discussion and responses, and each responder's alerts.
`roomDashboard` states that result once.

_Source: [`examples/operations-room/src/composition/room.ts`](../../examples/operations-room/src/composition/room.ts)_

```ts
export const roomDashboard = former(
  "the operations room (room)",
  (
    { room },
    {
      name,
      host,
      responder,
      selection,
      mitigation,
      discussion,
      response,
      author,
      text,
      alert,
      subject,
      alertedMitigation,
    },
  ) =>
    where(Gathering._get({ gathering: room }).is({ name, host })).form({
      room,
      name,
      host,
      responders: each(Gathering._members({ gathering: room }).is({ member: responder })).form({
        responder,
        alerts: each(Alerting._openFor({ recipient: responder }).is({ alert, subject }))
          .where(Selecting._get({ selection: subject }).is({ item: alertedMitigation }))
          .form({ alert, mitigation: alertedMitigation }),
      }),
      current: where(
        whether(Selecting._current({ scope: room }).is({ selection, item: mitigation })),
        whether(Discussing._openFor({ subject: selection }).is({ discussion })),
      ).form({
        mitigation,
        discussion,
        responses: each(Discussing._responses({ discussion }).is({ response, author, text })).form({
          response,
          responder: author,
          text,
        }),
        responseCount: each(
          Discussing._responses({ discussion }).is({ response, author, text }),
        ).count(),
      }),
    }),
);
```

The dashboard calls `each(Alerting._openFor(...)).form(...)` to form an alert
row for each responder. Within that call, `Selecting._get(...)` resolves the
alert subject to its mitigation.

`current` reads two at-most-one lines under `whether`. With no current
selection, their dependent leaves are `null`, `responses` is `[]`, and
`responseCount` is `0`. The record keeps the same shape. A selected mitigation
without the discussion reaction similarly leaves `discussion` as `null`.

The dashboard calls `each(Discussing._responses(...)).form(...)` to return the
response rows. It calls `each(Discussing._responses(...)).count()` to return
their count. The count is calculated when the dashboard is requested rather
than stored beside the responses.

With the discussion and alert reactions included, the formed result contains
the opened `discussion-1` with a response count of `0`. Mara's alert resolves
to `rollback-build-842`, and Lin's separate alert resolves to the same
mitigation.

The application authors the dashboard tree once in `roomDashboard`. The room
boundary fills its `(room)` slot and returns the formed tree, while the
generated wire carries that shape to TypeScript. A new field therefore changes
the former instead of a second response model. The [application boundary
chapter](application-boundary.md#generate-the-wire-contract) shows how that
formed answer reaches the wire.

For exact absence and read-failure behavior after authoring, continue to
[Execution semantics](../semantics.md#views-and-formers).
