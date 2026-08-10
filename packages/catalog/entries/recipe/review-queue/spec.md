# Review Queue recipe

## Purpose

Assign a durable review and keep it in the reviewer's attention queue until the review
reaches a terminal decision.

## Concepts

Approving owns Reviews and decisions. Alerting owns the reviewer's pending Alert.
Timing supplies one request or decision time.

## Decisions

Creating a Review raises an Alert whose Subject and Cause are the Review identity.
Approving, rejecting, or withdrawing a Review acknowledges that Alert. Actor
identities must come from a trusted boundary. Repair is an operational route for
trusted callers and derives the recipient from the Review rather than from request
input. Approval is evidence only and does not itself authorize another concept
action.

## Endpoints

- `RequestQueuedReview` — `/review-queue/request`
- `ApproveQueuedReview` — `/review-queue/approve`
- `RejectQueuedReview` — `/review-queue/reject`
- `WithdrawQueuedReview` — `/review-queue/withdraw`
- `RepairReviewAlert` — `/review-queue/repair`
- `GetReviewQueue` — `/review-queue/get`

## Failure and repair

A Review may persist before its Alert is raised. Repair uses the Review identity as
both Subject and Cause, making a missing-Alert raise idempotent. A terminal decision
may persist before acknowledgement. When no open Alert exists after a decision, that
decision endpoint returns `REVIEW_ALERT_MISSING`; repair raises the missing Alert and
closes it. Repair returns `REVIEW_NOT_FOUND` for an unknown Review. The recipe does
not roll back a Review when an Alert effect refuses or faults, and it includes no
downstream effect of approval.
