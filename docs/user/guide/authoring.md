# Application authoring

This guide follows the Operations Room application from concept registration
to a client typed by its generated wire contract. It assumes TypeScript, a Bun
package with a concept-free assembly, and the [application model](../overview.md).
The snippets are excerpts from the standalone Operations Room example, not a
second setup template.

Use the [Public API](../reference/public-api.md) for signatures and [Execution
semantics](../reference/semantics.md) for runtime guarantees.

## Prerequisites

Use a copy of [`examples/operations-room`](../../../examples/operations-room/)
to run this guide's commands unchanged. When extending the files created by
[Getting started](getting-started.md), follow the same sequence but adapt the
module names and package scripts to the application. The example's
`package.json` supplies every script used below.

The linked files contain the imports, declarations, and test setup omitted from
the excerpts.

## Organize application-owned design

Configure `@design/*` to resolve to `design/*`, then use these paired locations:

| Authored design                 | Executable source and focused test                                                     |
| ------------------------------- | -------------------------------------------------------------------------------------- |
| `design/concepts/Name.md`       | `src/concepts/Name.ts`, optional `Name.registry.ts`, and `tests/concepts/Name.test.ts` |
| `design/compositions/Group.md`  | `src/compositions/Group.ts` and `tests/compositions/Group.test.ts`                     |
| optional `design/vocabulary.md` | `src/vocabulary.ts`                                                                    |

Do not add a design README or index. A concept registry imports
`@design/concepts/Name.md`; `src/vocabulary.ts` collects the registrations in
`conceptSet(...)`. When `design/vocabulary.md` exists, `src/vocabulary.ts`
imports and exports it as `spec`. The filename is conventional and has no
special registration or runtime meaning. Each `src/compositions/Group.ts`
likewise imports and exports `@design/compositions/Group.md` as `spec`.

Write each composition document around its overall purpose. Under
`## Compositions`, add `###` entries whose names match the larger executable
reaction or endpoint groups. Add `## Views` or `## Formers` only for reads with
independent application meaning. Keep the canonical application categories
separate: `compositions` contains the larger reaction and endpoint groups, while
`views` and `formers` are separately owned. A self-contained group may export
all three records; an application with shared read modules may build the same
shape at assembly. Install every read exactly once. Another group may reuse an
imported read without re-exporting it.

## Define one behavior

Design the concept's purpose, principle, owned state, actions, queries, and
expected refusals before writing its class. [Designing with
concepts](../design.md) gives the criteria.

_Source: [`examples/operations-room/design/concepts/Alerting.md`](../../../examples/operations-room/design/concepts/Alerting.md)_

````text
## Actions

```actions
raise (recipient: Person, subject: Subject) : return (alert: Alert)
  then
    add a new alert with recipient and subject
    return alert

acknowledge (alert: Alert) : return (alert: Alert)
  where alert not in alerts
  then
    refuse ALERT_NOT_FOUND "There is no such open alert."
  where alert in alerts
  then
    delete alert
    return alert
```

## Queries

```queries
_openFor (recipient: Person) : many (alert: Alert, subject: Subject)
  answers no rows for a Person with no open Alerts
  orders rows by when each Alert was raised
```
````

Non-underscore prototype methods are actions; underscore-prefixed methods are
queries. Use ECMAScript `#private` methods or module functions for helpers.

_Source: [`examples/operations-room/src/concepts/Alerting.ts`](../../../examples/operations-room/src/concepts/Alerting.ts)_

```ts
  raise({ recipient, subject }: { recipient: string; subject: string }) {
    const alert = this.freshID();
    this.alerts.set(alert, { alert, recipient, subject });
    return { alert };
  }

  acknowledge({ alert }: { alert: string }) {
    if (!this.alerts.delete(alert)) throw new AlertNotFound();
    return { alert };
  }

  _openFor({ recipient }: { recipient: string }): Alert[] {
    return [...this.alerts.values()].filter((alert) => alert.recipient === recipient);
  }
```

Test the principle against the class directly, as
`tests/concepts/Alerting.test.ts` does with deterministic identities. This
separates concept behavior from assembly and composition.

_Source: [`examples/operations-room/src/concepts/Alerting.registry.ts`](../../../examples/operations-room/src/concepts/Alerting.registry.ts)_

```ts
export const alerting = registerConcept({
  class: AlertingConcept,
  spec,
  refusals: { ALERT_NOT_FOUND: AlertNotFound },
  floors: {
    deterministic: ({ identities }: { identities: Record<string, () => string> }, name: string) =>
      new AlertingConcept(identities[name]),
  },
});
```

`conceptSet(...)` gives registrations their application names and derives the
inert authoring references and vocabulary.

_Source: [`examples/operations-room/src/vocabulary.ts`](../../../examples/operations-room/src/vocabulary.ts)_

```ts
export const operationsRoomConcepts = conceptSet({
  Gathering: gathering,
  Selecting: selecting,
  Discussing: discussing,
  Alerting: alerting,
});

export const { concepts, vocabulary } = operationsRoomConcepts;
```

[Concept specification format](../reference/concept-specification.md) defines the parsed
grammar and registration checks. [Registration and
floors](../reference/public-api.md#registration-and-floors) defines implementation
factory context and lifecycle.

## Connect independent behaviors

Keep concept implementations independent of peer concepts and put
cross-concept decisions in composition. Operations Room installs two reactions
after a mitigation is selected:

_Source: [`examples/operations-room/src/compositions/MitigationDiscussion.ts`](../../../examples/operations-room/src/compositions/MitigationDiscussion.ts)_

```ts
export const SelectedMitigationOpensDiscussion = reaction(({ selection }) =>
  when(Selecting.choose({}).responds({ selection })).then(Discussing.open({ subject: selection })),
);
```

The independently selectable alert pack states the other consequence:

_Source: [`examples/operations-room/src/compositions/MitigationAlerts.ts`](../../../examples/operations-room/src/compositions/MitigationAlerts.ts)_

```ts
export const SelectedMitigationAlertsResponders = reaction(({ room, selection, responder }) =>
  when(Selecting.choose({ scope: room }).responds({ selection }))
    .where(Gathering._members({ gathering: room }).is({ member: responder }))
    .then(Alerting.raise({ recipient: responder, subject: selection })),
);
```

The first rule asks one consequence. The many-row membership query fans the
second rule out once per matching responder. Separate reactions keep the two
consequences independently selectable. A reaction is not a transaction: each
concept action settles independently, and a later failure does not roll back an
earlier action. [Designing reactions](../design.md#designing-reactions) covers
placement; [Reaction semantics](../reference/semantics.md#reactions) defines
matching and failure.

Name reusable or replaceable policy as views:

_Source: [`examples/operations-room/src/views/RespondersMayContribute.ts`](../../../examples/operations-room/src/views/RespondersMayContribute.ts)_

```ts
export const responderMayContribute = view(
  "(responder) may contribute in (room)",
  ({ responder, room }, _outputs, _bindings) =>
    where(Gathering._membership({ gathering: room, member: responder }).is({ joined: true })),
).holds();
```

The module also exports the complementary denial relation and response code. The
host-only policy exports the same names, so assembly can select either module
without changing the endpoints.

## Build current-state reads

A former constructs a current result tree from queries, views, or other
formers:

_Source: [`examples/operations-room/src/formers/Room.ts`](../../../examples/operations-room/src/formers/Room.ts)_

```ts
export const responderRoster = former("the responder roster of (room)", ({ room }, { responder }) =>
  form({
    responders: each(Gathering._members({ gathering: room }).is({ member: responder })).form({
      responder,
    }),
  }),
);
```

The complete
[`roomDashboard`](../../../examples/operations-room/src/formers/Room.ts) combines
queries from all four concepts and handles optional current state. Use the [read
construction cookbook](read-construction.md) for `no`, `whether`, folds, splicing, and
cardinality contrasts; [Views and formers](../reference/semantics.md#views-and-formers)
defines production behavior.

## Application boundary

### Receive, ask, respond

_Source: [`examples/operations-room/src/compositions/Room.ts`](../../../examples/operations-room/src/compositions/Room.ts)_

```ts
export const ChooseMitigation = endpoint(
  "/rooms/choose-mitigation",
  ({ room, mitigation, selection }) =>
    receive({ room, mitigation })
      .then(Selecting.choose({ scope: room, item: mitigation }).responds({ selection }))
      .then(respond({ mitigation })),
);
```

When a concept action throws a registered refusal class, the boundary returns
the registered code as a domain error. An unregistered throw instead follows
the opaque framework-failure path. Case-split endpoints must answer every
admitted case deliberately; branches have no fall-through priority. See
[endpoint settlement](../reference/semantics.md#sibling-paths-and-endpoint-settlement).

### Assemble the application

Select implementations and composition before calling `assemble(...)`. Each
call creates a new process-local runtime; changing an option later does not
reconfigure an existing assembly:

_Source: [`examples/operations-room/src/assembly.ts`](../../../examples/operations-room/src/assembly.ts)_

```ts
export function assembleOperationsRoom({
  alerts = true,
  contributions = "responders",
  discussion = true,
  instances = {},
}: OperationsRoomOptions = {}) {
  const policy = contributions === "responders" ? respondersMayContribute : hostMayContribute;
  const selected = { ...operationsRoomConcepts.implementations(), ...instances };

  return assemble({
    vocabulary,
    instances: selected,
    composition: {
      compositions: {
        room,
        mitigationDiscussion: discussion ? mitigationDiscussion : {},
        mitigationAlerts: alerts ? mitigationAlerts : {},
        contributions: contributionEndpoints({
          denied: policy.deniedContribution,
          mayContribute: policy.responderMayContribute,
          mayNotContribute: policy.responderMayNotContribute,
        }),
      },
      views: { contributionPolicy: policy },
      formers: roomFormers,
    },
  });
}
```

Use fixed records for selectable packs, interchangeable modules for policy, and
application-called factories when declarations depend on policy. Assembly walks
the resulting records but does not invoke function leaves. Ordinary assembly
rejects local executable declarations before exposing routes.

[`src/edge.ts`](../../../examples/operations-room/src/edge.ts) places
`createGateway(...)` in front of the assembly. The gateway provides public
admission, timeout and abort waiting, optional limits and observers, and ordered
drain without creating another reaction engine.

### Generate the wire contract

_Source: [`examples/operations-room/generated.config.ts`](../../../examples/operations-room/generated.config.ts)_

```ts
import { assembleOperationsRoom } from "./src/assembly.ts";

export default {
  assemble: assembleOperationsRoom,
  title: "Operations room",
  vocabulary: { module: new URL("./src/vocabulary.ts", import.meta.url) },
};
```

Pinning updates generated files; checking verifies that committed files match
the current assembly:

```sh
bun run artifacts:pin
bun run artifacts:check
```

Do not generate inside an example installed under `node_modules`. Commit the
generated files, change their owning declarations rather than editing them, and
keep the generated wire with the vocabulary declarations referenced by its
type-only import. [Generated descriptor](../reference/public-api.md#generated-descriptor)
defines configuration; [Generated wire](../reference/semantics.md#generated-wire) defines
derivation.

### Add runtime validation

Generated TypeScript constrains typed callers but does not validate values at
runtime. Attach synchronous endpoint validators under the third `endpoint(...)`
argument's
`validators.input`, `validators.output`, and `validators.domainError` fields when
the boundary requires them. [Endpoints](../reference/public-api.md#endpoints) defines
the result shape; [Runtime validation](../reference/semantics.md#runtime-validation)
defines ordering and failure.

### Call the typed client

_Source: [`examples/operations-room/src/client.ts`](../../../examples/operations-room/src/client.ts)_

```ts
export type OperationsRoomClient = Client<OperationsRoomWire>;

export async function loadRoomDashboard(client: OperationsRoomClient, room: string) {
  const result = await client.rooms.get({ room });
  if ("error" in result) return { message: `Could not load the room: ${result.error}` };
  return result.dashboard;
}
```

The `error` check narrows the generated success-or-error union. The [`client`
API](../reference/public-api.md#client) defines local and custom transports.

## Verify the application

From a standalone copy of `examples/operations-room`, run:

```sh
bun install
bun run check
bun run start
```

`check` covers formatting, types, tests, and pinned artifacts. `start` prints
the deterministic dashboard and the `ALREADY_JOINED` refusal from a repeated
join; a missing refusal fails the scenario. Deployment checks must also cover
persistence, traffic, and shutdown responsibilities described in [Operational
limits](../reference/operations.md). [Execution
semantics](../reference/semantics.md) defines omitted failure and ordering
details.
