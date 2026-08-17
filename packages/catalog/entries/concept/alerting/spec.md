# Alerting

## Purpose

Keep an addressed matter visible until its recipient acknowledges it, so pending
attention survives retries and does not depend on memory.

## Principle

An alert is raised for Mina about subject `deployment-7` with cause `selection-12`.
Replaying the same raise returns the same alert instead of creating a duplicate. Mina
sees the alert and acknowledges it. A second acknowledgement and an acknowledgement
by Jo are refused. Replaying the original raise after acknowledgement does not reopen
the matter.

## Types

```types
external Recipient
  The identity expected to acknowledge an alert.
external Subject
  The matter requiring attention.
external Cause
  The event or condition that raised the alert.
```

## State

```state
a seq of Alerts with
  a recipient Recipient
  a subject Subject
  a cause Cause
  a raisedAt DateTime
  an open Flag

at most one Alert has each recipient and cause pair

alias Alert for Alerts
```

## Actions

```actions
raise (recipient: Recipient, subject: Subject, cause: Cause, at: DateTime) : return (alert: Alert)
  where an Alert has recipient and cause and the same subject
  then
    bind alert to that Alert
    return alert
  where an Alert has recipient and cause but a different subject
  then
    refuse ALERT_CAUSE_CONFLICT "This alert cause is already associated with another subject for the recipient."
  where no Alert has recipient and cause
  then
    add a new open Alert with recipient, subject, cause, and raisedAt at
    return alert

acknowledge (alert: Alert, recipient: Recipient) : return (alert: Alert)
  where alert is unknown, is not open, or does not have recipient
  then
    refuse ALERT_NOT_OPEN_FOR_RECIPIENT "There is no such open alert for this recipient."
  where alert is open and has recipient
  then
    mark the Alert closed
    return alert
```

## Queries

```queries
_openFor (recipient: Recipient) : many (alert: Alert, subject: Subject, cause: Cause, raisedAt: DateTime)
  answers no rows for a Recipient with no open Alerts
  orders rows by raisedAt and then Alert identity
_get (alert: Alert) : optional (recipient: Recipient, subject: Subject, cause: Cause, raisedAt: DateTime, open: Flag)
  answers no row for an unknown Alert
```
