# Review Queue

A review queue assigns durable reviews and keeps each one in its reviewer's attention until a terminal decision.

## Application types and instances

```types
concrete Subject
  An object submitted to the application for review.

concrete Person
  A requester or reviewer identity supplied by the application.
```

```instances
instantiate Timing

instantiate Approving with
  Subject is Subject
  Person is Person

instantiate Alerting with
  Recipient is Person
  Subject is Approving.Review
  Cause is Approving.Review
```

## Compositions

### ReviewRequests

Requesting a review persists it and raises an Alert whose Subject and Cause are the Review identity. The Review may persist before the Alert, and the recipe does not roll it back when that effect refuses or faults.

### ReviewDecisions

A reviewer may approve or reject, and a requester may withdraw. Each terminal decision acknowledges the review Alert. Trusted boundaries must supply actor identities; approval is evidence and does not itself authorize another concept action. A committed decision with no open Alert returns `REVIEW_ALERT_MISSING`.

### ReviewRepair

Trusted repair derives the recipient from the Review. It idempotently raises a missing Alert for a pending review, or raises and closes one for a terminal review. An unknown Review returns `REVIEW_NOT_FOUND`.

### ReviewQueues

A reviewer may open their queue of pending Reviews and Alerts.

## Views

### OpenReviewAlert

The open review Alert has the Review identity as both Subject and Cause.

### PendingReviewForRepair

A pending Review supplies its reviewer and request time for repair.

### TerminalReviewForRepair

A terminal Review supplies its reviewer and request time for repair.

## Formers

### QueuedAlert

A queued alert combines an open Alert with its pending Review details.

### ReviewQueue

The review queue lists one reviewer's queued alerts.
