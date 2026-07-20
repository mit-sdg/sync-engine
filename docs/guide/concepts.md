# Define one behavior

A concept starts as a specification, then becomes a plain TypeScript class and
a test of the same story. This order keeps the behavior clear before the
application gives it a public name or connects it to anything else.

The operations room needs alerts that remain open until someone acknowledges
them. Start with the Purpose and Principle from Alerting's specification:

_Source: [`examples/concepts/alerting/spec.md`](../../examples/concepts/alerting/spec.md)_

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

_Source: [`examples/concepts/alerting/spec.md`](../../examples/concepts/alerting/spec.md)_

````text
```state
a set of Alerts with
  a recipient Person
  a subject Subject
```
````

Its actions state every successful change and the case the concept refuses:

_Source: [`examples/concepts/alerting/spec.md`](../../examples/concepts/alerting/spec.md)_

````text
```actions
raise (recipient: Person, subject: Subject) : return (alert: Alert)
  then
    add a new alert with recipient and subject
    return alert

acknowledge (alert: Alert) : return (alert: Alert), refuse (message: String)
  where alert not in alerts
  then
    refuse "There is no such open alert."
  where alert in alerts
  then
    delete alert
    return alert
```
````

An **action** may change the concept's state. `raise` adds an alert;
`acknowledge` removes one or refuses when the alert is no longer open. Every
input is present, and every branch says what it returns.

## Implement the concept in ordinary TypeScript

The class has no engine base class and imports no application code. Its public
methods implement the actions, while the underscore-prefixed method only reads
current state.

_Source: [`examples/concepts/alerting/alerting.ts`](../../examples/concepts/alerting/alerting.ts)_

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

## Define the query shape

A **query** only reads state. A concept may promise its cardinality with
`static readonly queries`: `one`, `optional`, or `many`. A `one` query returns
one record. The other two return arrays containing at most one row or any
number of rows. Without a declaration, a query may return one record or an
array and is treated as potentially many. `_openFor` promises `many` because
one recipient may have any number of open alerts.

Gathering shows both query shapes next to each other:

_Source: [`examples/concepts/gathering/gathering.ts`](../../examples/concepts/gathering/gathering.ts)_

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

Gathering declares `_members: "many"` and `_membership: "one"` on its class.
The engine checks both the returned shape and each read's cardinality. A reaction
cannot range with `each(...)` over `_membership`, and the implementation
cannot answer `_membership` with an array.

## Test the principle directly

The concept test uses the class without assembling an application. It gives the
class deterministic identities, follows the Principle, and checks both the
state it exposes and its refusal.

_Source: [`examples/concepts/alerting/alerting.test.ts`](../../examples/concepts/alerting/alerting.test.ts)_

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

The registry beside the concept connects the plain class to its specification
and maps the refusal class to the stable code an application can return.
The code and its public category are the machine contract. The refusal sentence
in the specification is the normative human explanation. When detail reaches a
caller, the implementation must use that sentence exactly; otherwise the
boundary must omit the competing detail.

Use the canonical `assembly` entrypoint:

_Source: [`examples/concepts/alerting/registry.ts`](../../examples/concepts/alerting/registry.ts)_

```ts
import { registerConcept } from "@mit-sdg/sync-engine/assembly";
```

Alerting's registry keeps the prose in `spec.md`, registers the one deliberate
refusal, and declares its participation in the deterministic example floor:

_Source: [`examples/concepts/alerting/registry.ts`](../../examples/concepts/alerting/registry.ts)_

```ts
export const alerting = registerConcept({
  class: AlertingConcept,
  spec,
  refusals: {
    ALERT_NOT_FOUND: { error: AlertNotFound, on: ["acknowledge"] },
  },
  floors: {
    deterministic: ({ identities }: DeterministicFloorContext) =>
      new AlertingConcept(identities.Alerting),
  },
});
```

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
