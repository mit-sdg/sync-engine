# Define one behavior

A concept starts as a specification, then becomes a plain TypeScript class and
a test of the same story. This order keeps the behavior clear before the
application gives it a public name or connects it to anything else.

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

A `refuse` branch names the stable code the boundary returns and the sentence
that explains it. Both are contract: registration derives which actions may
refuse which codes from these lines, and the sentence is what a caller
receives — so the class never has to repeat it.

## Implement the concept in ordinary TypeScript

The class has no engine base class and imports no application code. Its public
methods implement the actions, while the underscore-prefixed method only reads
current state.

_Source: [`examples/operations-room/src/concepts/alerting/alerting.ts`](../../examples/operations-room/src/concepts/alerting/alerting.ts)_

```ts
  raise({ recipient, subject }: { recipient: string; subject: string }) {
    const alert = this.freshID();
    this.alerts.set(alert, { alert, recipient, subject });
    return { alert };
  }

  acknowledge({ alert }: { alert: string }) {
    if (!this.alerts.delete(alert)) throw new AlertNotFound("There is no such open alert.");
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
`one`. The engine checks both the returned shape and each read's cardinality. A
reaction cannot range with `each(...)` over `_membership`, and the
implementation cannot answer `_membership` with an array. Registration also
holds the two documents to each other: a query the class implements but the
specification omits — or the reverse — fails by name before anything runs.

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
  expect(repeatedAcknowledgement).toThrow("There is no such open alert.");
});
```

## Give the concept its public name

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

Registration reads the specification and holds it to the class. A refusal the
document declares with no `Error` class to signal it, an `Error` class for a
branch the document never names, an action or query on one side but not the
other, or a signature naming inputs the implementation does not take — each
fails at registration, naming what disagreed.

The operations room includes that registry once in its explicit concept set.
The set derives its vocabulary, public references, ordinary implementations,
and complete named floors. Each composition file destructures only the
references it uses from the set's `concepts` object.

Alerting never names Gathering, Selecting, Discussing, an operations room, or
a reading circle. It owns one lifecycle and refers only to the roles inside
that lifecycle. With Alerting in the concept set, the application can connect a
selection on a returned occurrence without changing this specification, class,
or test.

Continue to [Reactions](reactions.md) to connect the plain concepts in the
application composition.
