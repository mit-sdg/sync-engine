# Alerting

## Purpose

Keep an alert visible to its recipient until they acknowledge it, so pending
matters do not depend on memory.

## Principle

An alert is raised for Mina about a failed checkout, followed by one about a
delayed deployment. She sees both in that order. An alert raised for Jo does not
change Mina's alerts. Mina acknowledges the failed-checkout alert; her delayed-
deployment alert and Jo's alert remain. Trying to acknowledge the first alert
again is refused because it is no longer open.

## State

```state
a set of Alerts with
  a recipient Person
  a subject Subject
```

## Actions

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

`_openFor` answers every open alert for a recipient in order. Alerting does not
decide which events deserve attention or what an alert's subject represents.
