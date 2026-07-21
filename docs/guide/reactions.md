# Connect independent behaviors

Selecting knows how to keep one current item within a scope. Discussing knows
how to open a discussion about a subject. Neither concept decides that choosing
an operations-room mitigation should open a discussion. The application owns
that connection as a reaction.

Import the reaction vocabulary from the canonical `language` entrypoint:

_Source: [`examples/operations-room/src/composition/packs.ts`](../../examples/operations-room/src/composition/packs.ts)_

```ts
import { reaction, when } from "@mit-sdg/sync-engine/language";
```

## Ask for one consequence

The first reaction has one returned occurrence under `when` and one callable
action line under `then`:

_Source: [`examples/operations-room/src/composition/packs.ts`](../../examples/operations-room/src/composition/packs.ts)_

```ts
export const SelectedMitigationOpensDiscussion = reaction(({ selection }) =>
  when(Selecting.choose({}).responds({ selection })).then(Discussing.open({ subject: selection })),
);
```

Read it in order: when `Selecting.choose` returns a `selection`, ask
`Discussing.open` with that selection as its subject.

A line ending in `.responds(...)` watches a **returned occurrence**: the action
succeeded and its state change took effect. The call pattern matches inputs;
the response pattern binds `selection`.
The consequence then asks Discussing to open the discussion; Discussing still
decides whether its own action returns or refuses.

The fixed frame is `when A.action responds … then B.action`. The consequence
line is the ask; no wrapper changes its posture.

## Add one required read

Choosing a mitigation should also alert every responder in the room. Keep the
same `when` and action-line frame, and add one standing read under `where`:

_Source: [`examples/operations-room/src/composition/packs.ts`](../../examples/operations-room/src/composition/packs.ts)_

```ts
export const SelectedMitigationAlertsResponders = reaction(({ room, selection, responder }) =>
  when(Selecting.choose({ scope: room }).responds({ selection }))
    .where(Gathering._members({ gathering: room }).is({ member: responder }))
    .then(Alerting.raise({ recipient: responder, subject: selection })),
);
```

The returned `choose` occurrence supplies `room` from its `scope` input and
`selection` from its output. The plain `Gathering._members` line reads the
room's members and binds each one as `responder`. The reaction fires once for each
row, so Mara and Lin receive separate alert asks. If the query finds no
members, there is no binding and this reaction does not fire.

The construction retains `when A.action … then B.action` and adds a
plain query line under `where`. `_members` promises many rows, so the line
continues once per distinct member and stops this reaction when there are
none. The author writes no quantity at the use-site. Here `room` is already
bound by `when`, so the query reads that room; the fresh `responder` name in
`.is` opens once for each matching row.

## Group sibling branches

Separate reactions are independent: if both match one occurrence, both fire.
When several branches express one reaction, place them together in `then`.
Every sibling ends in a stable `.named(...)` label. Matching siblings run
independently; the group makes no disjointness or coverage claim.

The [example book](../book.md#11--siblings-on-an-ordinary-reaction) shows a
shared prefix and an equality split.

## Chain only after a return

A later `.then(...)` starts after the preceding action on its own path returns:

_Source: [reading-circle.ts](../../examples/reading-circle/src/composition/reading-circle.ts)_

```ts
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
```

The second stage can use `response` because the first action returned it. A
refusal or fault stops this chain. When a sibling group precedes a later
stage, each sibling continues independently; the later stage does not wait for
the other siblings.

A qualified sibling can carry its own chain before its trailing label:

```ts
where(Gathering._get({ gathering: circle }).is({ host: member }))
  .then(Selecting.choose({ scope: circle, item: reading }).responds({ selection }))
  .then(respond({ selection }))
  .named("host"),
```

The label names the whole branch. Local stages cannot carry labels, and a
named branch cannot be extended.

## Condition on an action's outcome

The output pattern in `when` can test a returned value as well as bind one.
`Approved` accepts only a returned route whose
value is the literal `"approved"`. `{ by: "Route" }` also requires the
occurrence to have been asked for by the `Route` reaction. A direct call to the
same action does not continue this chain.

```text
      Approved: reaction((_: Vars) =>
        when(Decision.decide({}).responds({ route: "approved" })).then(
          Recorder.record({ tag: "approved" }),
        ),
      ),
```

Declared refusals travel on a posture channel. The pattern can bind the whole
`refusal` payload or its `message`; this example binds `message` and pins the
channel to the ask made by `Try`.

```text
      Recover: reaction(({ message }: Vars) =>
        when(refused({ action: "fail", message }, { by: "Try" })).then(
          Recorder.record({ tag: message }),
        ),
      ),
```

`returned(...)` and `refused(...)` match channels across actions. Their
patterns can also bind `concept`, `action`, and `input`; returned payloads use
the `result` key and refused payloads use `refusal`. The `by` option is the
provenance pin that makes a channel continuation belong to one asking
reaction. A runtime fault is a separate advanced channel and never matches
`refused(...)`.

## Keep the reaction in the composition

Concept classes name no peers, so the application states each cross-behavior
decision as a reaction. In this example, adding alerts changes the composition
while Selecting, Gathering, Discussing, and Alerting keep the same
specifications and implementations.

Continue to [Application boundary](application-boundary.md) to assemble the
composition and carry its actions and formed answers to callers.
