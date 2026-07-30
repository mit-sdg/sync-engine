# Connect independent behaviors

This guide uses the complete concept set from the [Operations Room
example](../../examples/operations-room/README.md), including Gathering,
Selecting, Discussing, and the Alerting concept developed in [Define one
behavior](concepts.md). It introduces the ordinary public reaction surface: one
trigger, current-state reads, independent paths, and temporal chains. The [Read
construction cookbook](../book.md) contains close construction variants;
[Execution semantics](../semantics.md#reactions) defines matching, ordering, and
failure behavior.

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
the response pattern binds `selection`. The consequence asks Discussing to open
the discussion, and Discussing still decides whether its own action returns or
refuses.

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

## Keep independent consequences independent

Operations Room has two separate reactions for one returned selection: one
opens a discussion and one alerts each responder. If both packs are present,
both reactions match and run. Their source order is not priority.

When several alternatives express one reaction, place them together in one
`then(...)` group. Every sibling ends in a stable `.named(...)` label. Each
matching sibling runs independently; the group does not claim that the
conditions are exclusive or complete.

The [read construction cookbook](../book.md#11--siblings-on-an-ordinary-reaction) shows a
shared prefix and an equality split.

## Chain only after a return

A later `.then(...)` starts after the preceding action on its own path returns.
The contribution endpoint, examined in [Application
boundary](application-boundary.md), uses that rule to wait for
`Discussing.respond` before answering the caller:

_Source: [`examples/operations-room/src/composition/contributions.ts`](../../examples/operations-room/src/composition/contributions.ts)_

```ts
const AddContribution = endpoint(
  "/rooms/contribute",
  ({ room, responder, text, selection, discussion, response }) =>
    receive({ room, responder, text })
      .where(
        mayContribute({ responder, room }),
        Selecting._current({ scope: room }).is({ selection }),
        Discussing._openFor({ subject: selection }).is({ discussion }),
      )
      .then(Discussing.respond({ discussion, author: responder, text }).responds({ response }))
      .then(respond({ response })),
);
```

The final stage can use `response` because the preceding action returned it. A
refusal or fault stops this path. When a sibling group precedes a later stage,
each sibling continues independently; the later stage does not wait for the
other siblings. The engine pins a chained response pattern to the exact ask
from the preceding stage, so another matching `Discussing.respond` call cannot
advance this path.

## Choose the trigger posture

`when(Concept.action(pattern))` watches the ask before the action body runs.
`.responds(...)` watches a successful return, and `.refuses(...)` watches a
declared rejection. Output patterns can test literals or bind fresh names. Use
the action-specific forms when the concept and action are known. The generic
`returned(...)` and `refused(...)` channels support policies that deliberately
span actions; their exact payload and provenance options are in the [language
API](../public-surface.md#language).

Expected domain rejection belongs on the refusal posture. Do not return an
`{ error: ... }` object from a concept action and expect the engine to treat it
as a refusal; an ordinary returned object remains a successful result even when
it has an `error` key.

## Run the composition

From the repository root, run:

```sh
bun run example:operations
```

The default assembly includes both reaction packs. Its result contains the
discussion opened for the selected mitigation and one alert for each responder.
The [Operations Room README](../../examples/operations-room/README.md) describes
the deterministic scenario and the options that remove either pack.

## Keep the reaction in the composition

Concept classes name no peers, so the application states each cross-behavior
decision as a reaction. In this example, adding alerts changes the composition
while Selecting, Gathering, Discussing, and Alerting keep the same
specifications and implementations.

[Composing concepts](../design/composing-concepts.md) covers the design side of
these rules: what belongs in a reaction and what does not, cross-concept
invariants, authorization across boundaries, cycles, fan-out, and partial
failure.

Continue to [Views and formers](views-and-formers.md) to name shared questions
and shape complete answers before exposing them to callers.
