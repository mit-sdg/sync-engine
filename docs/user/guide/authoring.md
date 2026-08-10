# Application authoring

This guide follows one Operations Room application from concept registration
to a generated client. It is a how-to guide for an application that already
has a Bun package and a concept-free assembly; it assumes TypeScript and the
[application model](../overview.md). The linked source belongs to the standalone
Operations Room example, so the snippets show the roles and order of the work,
not a second setup template.

Follow the sections in order: define and register a concept; connect concepts;
build current-state reads; expose actions through endpoints; assemble, generate,
validate, and call the application; then run the example checks.

Use the [Public API](../reference/public-api.md) for signatures and [Execution
semantics](../reference/semantics.md) for runtime guarantees.

## Prerequisites

Start from the files created by [Getting started](getting-started.md), or work
from a copy of [`examples/operations-room`](../../../examples/operations-room/).
The example's `package.json` supplies the `artifacts:pin`, `check`, and `start`
scripts used below. A concept specification, implementation, registry, and
principle test belong together; this guide shows the specification and the
implementation shape, while the example contains the complete test setup.

## Define one behavior

Design the concept's purpose, principle, owned state, actions, queries, and
expected refusals before writing its class. [Designing with
concepts](../design.md) gives the criteria. The Alerting specification
declares two actions, one refusal, and one many-row query:

_Source: [`examples/operations-room/src/concepts/alerting/spec.md`](../../../examples/operations-room/src/concepts/alerting/spec.md)_

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

The class is ordinary TypeScript. Non-underscore prototype methods are actions;
underscore-prefixed methods are queries. Use ECMAScript `#private` methods or
module functions for helpers.

_Source: [`examples/operations-room/src/concepts/alerting/alerting.ts`](../../../examples/operations-room/src/concepts/alerting/alerting.ts)_

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
[`alerting.test.ts`](../../../examples/operations-room/src/concepts/alerting/alerting.test.ts)
does with deterministic identities. This separates concept behavior from
assembly and composition.

Register the class with its specification, refusal classes, and any named
implementation factories.

_Source: [`examples/operations-room/src/concepts/alerting/registry.ts`](../../../examples/operations-room/src/concepts/alerting/registry.ts)_

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

_Source: [`examples/operations-room/src/concept-set.ts`](../../../examples/operations-room/src/concept-set.ts)_

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

Keep concept implementations independent of peer concepts. Put cross-concept
decisions in composition. Operations Room installs two independent reactions
after a mitigation is selected:

_Source: [`examples/operations-room/src/composition/packs.ts`](../../../examples/operations-room/src/composition/packs.ts)_

```ts
export const SelectedMitigationOpensDiscussion = reaction(({ selection }) =>
  when(Selecting.choose({}).responds({ selection })).then(Discussing.open({ subject: selection })),
);

// .where() after .when() filters which matchings of the trigger cause the action
// to fire — here we only alert responders who are members of the room.
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

Name reusable or replaceable policy as views. The responder policy's affirmative
relation is:

_Source: [`examples/operations-room/src/composition/responders-may-contribute.ts`](../../../examples/operations-room/src/composition/responders-may-contribute.ts)_

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

## Views and formers

A view names a relation or policy decision. A former constructs a current result
tree from queries, views, or other formers. This former captures every member
returned by Gathering:

_Source: [`examples/operations-room/src/composition/room.ts`](../../../examples/operations-room/src/composition/room.ts)_

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
[`roomDashboard`](../../../examples/operations-room/src/composition/room.ts) combines
queries from all four concepts and handles optional current state. Use the [read
construction cookbook](read-construction.md) for `no`, `whether`, folds, splicing, and
cardinality contrasts; [Views and formers](../reference/semantics.md#views-and-formers)
defines production behavior.

## Application boundary

### Receive, ask, respond

An endpoint binds admitted input with `receive(...)`, asks concept actions, and
settles through `respond(...)`.

_Source: [`examples/operations-room/src/composition/room.ts`](../../../examples/operations-room/src/composition/room.ts)_

```ts
export const ChooseMitigation = endpoint(
  "/rooms/choose-mitigation",
  ({ room, mitigation, selection }) =>
    receive({ room, mitigation })
      .then(Selecting.choose({ scope: room, item: mitigation }).responds({ selection }))
      .then(respond({ mitigation })),
);
```

Registered concept refusals use the standard refusal path. Case-split endpoints
must answer every admitted case deliberately; branches have no fall-through
priority. See [endpoint
settlement](../reference/semantics.md#sibling-paths-and-endpoint-settlement).

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
      room,
      discussion: discussion ? { SelectedMitigationOpensDiscussion } : {},
      alerts: alerts ? { SelectedMitigationAlertsResponders } : {},
      policy,
      contributions: contributionEndpoints({
        denied: policy.deniedContribution,
        mayContribute: policy.responderMayContribute,
        mayNotContribute: policy.responderMayNotContribute,
      }),
    },
  });
}
```

Use fixed records for selectable packs, interchangeable modules for policy, and
application-called factories when declarations depend on policy. Assembly walks
the resulting records but does not invoke function leaves. Ordinary assembly
rejects local executable declarations before exposing routes.

[`src/edge.ts`](../../../examples/operations-room/src/edge.ts) places
`createGateway(...)` in front of the assembly. The gateway adds public admission,
limits, observation, timeout and abort waiting, and ordered drain without
creating another reaction engine.

### Generate the wire contract

The application-owned descriptor identifies the assembly and generated title:

_Source: [`examples/operations-room/generated.config.ts`](../../../examples/operations-room/generated.config.ts)_

```ts
import { assembleOperationsRoom } from "./src/assembly.ts";

export default {
  assemble: assembleOperationsRoom,
  title: "Operations room",
};
```

From an application-owned copy, pin and check generated artifacts. Pinning
updates generated files; checking only verifies that the committed files match
the current assembly:

```sh
bun run artifacts:pin
bunx sync-engine artifacts check
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

Code outside the assembly depends on a client typed by the generated wire:

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

The scenario crosses the assembly, gateway, generated local client, and
`roomDashboard` former. `check` covers the example's source, types, tests, and
pinned artifacts; `start` exercises the deterministic workflow. Keep those
checks separate from deployment checks, which must also account for persistence,
traffic, and shutdown responsibilities.

[Operational limits](../reference/operations.md) defines those deployment
responsibilities. [Execution semantics](../reference/semantics.md) remains the
authoritative source when the guide's representative construction leaves out a
failure or ordering detail.
