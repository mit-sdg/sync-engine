# Define one behavior

This guide uses the larger [Operations Room
example](../../examples/operations-room/README.md), not the Note Keeper
scaffold from [Getting started](getting-started.md). It shows how one of that
application's concepts becomes independently testable: specification, plain
TypeScript class, principle test, and registration. The authoritative grammar
is in [Concept specification format](../concept-specification.md).

The operations room needs alerts that remain open until someone acknowledges
them. Start with the Purpose and Principle from Alerting's specification:

_Source: [`examples/operations-room/src/concepts/alerting/spec.md`](../../examples/operations-room/src/concepts/alerting/spec.md)_

```text
## Purpose

Keep an alert visible to its recipient until they acknowledge it, so pending
matters do not depend on memory.

## Principle

An alert is raised for Mina about a failed checkout, followed by one about a
delayed deployment. She sees both in that order. An alert raised for Jo does not
change Mina's alerts. Mina acknowledges the failed-checkout alert; her delayed-
deployment alert and Jo's alert remain. Trying to acknowledge the first alert
again is refused because it is no longer open.
```

The Purpose says why the behavior matters. The Principle gives named people a
concrete sequence: raise alerts, keep each recipient's alerts separate,
acknowledge one, and refuse a repeated acknowledgement.

## Specify the state and actions

Alerting owns alerts and two facts about each one. `Person` and `Subject` are
opaque identities supplied by an application; Alerting neither creates nor
interprets them.

_Source: [`examples/operations-room/src/concepts/alerting/spec.md`](../../examples/operations-room/src/concepts/alerting/spec.md)_

````text
```state
a set of Alerts with
  a recipient Person
  a subject Subject
```
````

Its actions state every successful change and the case the concept refuses:

_Source: [`examples/operations-room/src/concepts/alerting/spec.md`](../../examples/operations-room/src/concepts/alerting/spec.md)_

````text
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
````

An **action** may change the concept's state. `raise` adds an alert;
`acknowledge` removes one or refuses when the alert is no longer open. Every
input is present, and every branch says what it returns.

A `refuse` branch names a stable code and its normative explanatory sentence.
Registration derives which actions may refuse which codes from these lines;
the registered `Error` class only signals the branch, so its own message is not
part of the contract. A direct call through `Assembly.concepts` receives the
code and the sentence as `detail`; the standard endpoint funnel sends the code
without that detail. [Execution semantics](../semantics.md#actions-refusals-and-faults)
defines these outcomes and keeps authored boundary error responses distinct.

## Implement the concept in ordinary TypeScript

The class has no engine base class and imports no application code. Its
non-underscore methods implement the specified actions, while the
underscore-prefixed method only reads current state. Do not use TypeScript
`private` or `protected` prototype methods as implementation helpers: those
methods remain visible to runtime registration. Use ECMAScript `#private`
methods or module-level functions instead.

_Source: [`examples/operations-room/src/concepts/alerting/alerting.ts`](../../examples/operations-room/src/concepts/alerting/alerting.ts)_

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

## Declare the queries

A **query** only reads state. The specification's `queries` fence names each
one and promises `one`, `optional`, or `many`. A `one` query returns one
record; the other two return arrays holding at most one row or any number of
rows. `_openFor` promises `many` because one recipient may have any number of
open alerts:

_Source: [`examples/operations-room/src/concepts/alerting/spec.md`](../../examples/operations-room/src/concepts/alerting/spec.md)_

````text
```queries
_openFor (recipient: Person) : many (alert: Alert, subject: Subject)
```
````

Gathering shows both query shapes next to each other:

_Source: [`examples/operations-room/src/concepts/gathering/gathering.ts`](../../examples/operations-room/src/concepts/gathering/gathering.ts)_

```ts
  _members({ gathering }: { gathering: string }): { member: string }[] {
    return [...this.memberships.values()]
      .filter((entry) => entry.gathering === gathering)
      .map(({ member }) => ({ member }));
  }

  _membership({ gathering, member }: { gathering: string; member: string }): { joined: boolean } {
    return { joined: this.#membership(gathering, member) !== undefined };
  }
```

Gathering's specification promises `_members` as `many` and `_membership` as
`one`. Registration records those promises. The engine checks a query's result
container and cardinality when a reaction, view, or former reads it. A reaction
cannot range with `each(...)` over `_membership`, and `_membership` cannot
answer with an array. Registration also holds the documents to each other: a
query the class implements but the specification omits—or the reverse—fails by
name before composed behavior runs.

## Test the principle directly

The concept test uses the class without assembling an application. It gives the
class deterministic identities, follows the Principle, and checks both the
state it exposes and its refusal.

_Source: [`examples/operations-room/src/concepts/alerting/alerting.test.ts`](../../examples/operations-room/src/concepts/alerting/alerting.test.ts)_

```ts
test("its principle: keep each recipient's alerts in order until acknowledged", () => {
  const alerting = new AlertingConcept(ids("first", "second", "other"));
  alerting.raise({ recipient: "Mina", subject: "selection-1" });
  alerting.raise({ recipient: "Mina", subject: "selection-2" });
  alerting.raise({ recipient: "Jo", subject: "selection-3" });

  expect(alerting._openFor({ recipient: "Mina" })).toEqual([
    { alert: "first", recipient: "Mina", subject: "selection-1" },
    { alert: "second", recipient: "Mina", subject: "selection-2" },
  ]);
  expect(alerting.acknowledge({ alert: "first" })).toEqual({ alert: "first" });
  expect(alerting._openFor({ recipient: "Mina" })).toEqual([
    { alert: "second", recipient: "Mina", subject: "selection-2" },
  ]);
  expect(alerting._openFor({ recipient: "Jo" })).toHaveLength(1);
  const repeatedAcknowledgement = () => alerting.acknowledge({ alert: "first" });
  expect(repeatedAcknowledgement).toThrow(AlertNotFound);
});
```

## Register the concept

The registry beside the concept connects the plain class to its specification.
It declares only what the specification cannot: which `Error` class signals
each refusal code the document already named. The actions, the queries, their
promises, which action refuses which code, and the sentence each refusal
carries all come from `spec.md`.

Use the canonical `assembly` entrypoint:

_Source: [`examples/operations-room/src/concepts/alerting/registry.ts`](../../examples/operations-room/src/concepts/alerting/registry.ts)_

```ts
import { registerConcept } from "@mit-sdg/sync-engine/assembly";
```

Alerting's registry names the class that signals its one deliberate refusal,
and declares its participation in the deterministic example floor. A floor
factory receives the name the concept is registered under, so the registry
never spells its own application name:

_Source: [`examples/operations-room/src/concepts/alerting/registry.ts`](../../examples/operations-room/src/concepts/alerting/registry.ts)_

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

Validation occurs at several distinct times:

| Time                | Checks                                                                                               |
| ------------------- | ---------------------------------------------------------------------------------------------------- |
| `registerConcept`   | Action/query names, declared refusal mappings, and input names recoverable by runtime reflection     |
| `sync-engine check` | Action/query names and input names recoverable from supported TypeScript source forms                |
| Assembly            | Composition names, binding availability, declaration compatibility, and supported registration forms |
| Query read          | Query result container and declared cardinality                                                      |
| Action execution    | The implementation's own value and domain checks                                                     |

Neither registration path validates state declarations, field types, returned
field names, uniqueness, or invariants. Query result checks do not validate row
fields against the prose output list. [Concept specification
format](../concept-specification.md) records the accepted source forms and
unchecked fields; [Execution semantics](../semantics.md#queries) defines read
failures.

The operations room includes that registry once in its explicit concept set.
The key `Alerting` in that set gives the concept its application name. The set
derives its vocabulary, public references, ordinary implementations, and
complete named floors. Each composition file destructures only the references
it uses from the set's `concepts` object.

Alerting never names Gathering, Selecting, Discussing, an operations room, or
a reading circle. It owns one lifecycle and refers only to the roles inside
that lifecycle. With Alerting in the concept set, the application can connect a
selection on a returned occurrence without changing this specification, class,
or test.

Continue to [Connect independent behaviors](reactions.md). For exact
`registerConcept`, `conceptSet`, and floor signatures, use the [assembly API
reference](../public-surface.md#assembly).
