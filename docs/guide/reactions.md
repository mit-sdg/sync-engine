# Connect independent behaviors

Selecting knows how to keep one current item within a scope. Discussing knows
how to open a discussion about a subject. Neither concept decides that choosing
an operations-room mitigation should open a discussion. The application owns
that connection as a reaction.

Import the reaction vocabulary from the canonical `language` entrypoint:

_Source: [`examples/operations-room/src/composition/packs.ts`](../../examples/operations-room/src/composition/packs.ts)_

```ts
import { reaction, request, when } from "@mit-sdg/sync-engine/language";
```

## Ask for one consequence

The first reaction has one returned occurrence under `when` and one request
under `then`:

_Source: [`examples/operations-room/src/composition/packs.ts`](../../examples/operations-room/src/composition/packs.ts)_

```ts
export const SelectedMitigationOpensDiscussion = reaction(({ selection }) =>
  when(Selecting.choose, {}, { selection }).then(request(Discussing.open, { subject: selection })),
);
```

Read it in order: when `Selecting.choose` returns a `selection`, request
`Discussing.open` with that selection as its subject.

A bare `when(Selecting.choose, …)` watches **returned occurrences** of that
action: the action succeeded and its state change took effect. The first pattern
object matches action inputs. This reaction uses `{}` because it needs none. The
second matches output roles on the returned occurrence and binds `selection`.
The consequence then asks Discussing to open the discussion; Discussing still
decides whether its own action returns or refuses.

The fixed frame is `when A.action … then request B.action`. The TypeScript
source keeps the same order:
`when(A.action, inputs, outputs).then(request(B.action, inputs))`.

## Add one required read

Choosing a mitigation should also alert every responder in the room. Keep the
same `when` and `request` frame, and add one standing read under `where`:

_Source: [`examples/operations-room/src/composition/packs.ts`](../../examples/operations-room/src/composition/packs.ts)_

```ts
export const SelectedMitigationAlertsResponders = reaction(({ room, selection, responder }) =>
  when(Selecting.choose, { scope: room }, { selection })
    .where(Gathering._members({ gathering: room }).is({ member: responder }))
    .then(request(Alerting.raise, { recipient: responder, subject: selection })),
);
```

The returned `choose` occurrence supplies `room` from its `scope` input and
`selection` from its output. The plain `Gathering._members` line reads the
room's members and binds each one as `responder`. The reaction fires once for each
row, so Mara and Lin receive separate alert requests. If the query finds no
members, there is no binding and this reaction does not fire.

The construction retains `when A.action … then request B.action` and adds a
plain query line under `where`. `_members` promises many rows, so the line
continues once per distinct member and stops this reaction when there are
none. The author writes no quantity at the use-site. Here `room` is already
bound by `when`, so the query reads that room; the fresh `responder` name in
`.is` opens once for each matching row.

## Group a proven partition

Separate reactions are independent: if both match one occurrence, both fire.
When two cases express one reaction and their conditions show that they
cannot both hold, group them as
`when(...).either(where(...).then(...), where(...).then(...))`. The case
builder `where` comes from the same `language` entrypoint as `when` and
`request`.

The [example book](../book.md#11--either-on-an-ordinary-reaction) shows a
shared prefix and an equality split. [Execution
semantics](../semantics.md#proven-partitions-and-either) owns the accepted proof
shapes, coverage account, and lowering guarantees. If registration cannot
prove the split, keep the cases as separate reactions or rewrite the conditions
so they state the partition.

## Condition on an action's outcome

The output pattern in `when` can test a returned value as well as bind one.
`Approved` accepts only a returned route whose
value is the literal `"approved"`. `{ by: "Route" }` also requires the
occurrence to have been asked for by the `Route` reaction. A direct call to the
same action does not continue this chain.

```ts
      Approved: reaction((_: Vars) =>
        when(Decision.decide, {}, { route: "approved" }, { by: "Route", posture: "returned" }).then(
          request(Recorder.record, { tag: "approved" }),
        ),
      ),
```

Declared refusals travel on a posture channel. The pattern can bind the whole
`refusal` payload or its `message`; this example binds `message` and pins the
channel to the ask made by `Try`.

```ts
      Recover: reaction(({ message }: Vars) =>
        when(refused({ action: "fail", message }, { by: "Try" })).then(
          request(Recorder.record, { tag: message }),
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
