# Approving

## Purpose

Separate a request from an assigned reviewer's durable decision, so pending work is
not mistaken for accepted work and a requester cannot approve the request alone.

## Principle

Ari requests review of subject `change-7` from Bo. A second pending review of the same
subject is refused. Ari cannot approve the request. Bo approves it, after which a
second decision and Ari's withdrawal are refused. A later request may create a new
review of the same subject without changing the first decision.

## Types

```types
external Subject
  The object submitted for review.
external Person
  The external identity of a requester or reviewer.
```

## State

```state
a set of Reviews with
  a subject Subject
  a requester Person
  a reviewer Person
  a status ReviewStatus
  a requestedAt DateTime
  an optional decidedAt DateTime
  an optional reason String

at most one pending Review has each Subject
```

## Actions

```actions
request (subject: Subject, requester: Person, reviewer: Person, at: DateTime) : return (review: Review)
  where requester is reviewer
  then
    refuse SELF_REVIEW_NOT_ALLOWED "A requester cannot review the same request."
  where a pending Review has subject
  then
    refuse REVIEW_ALREADY_PENDING "This subject already has a pending review."
  where requester differs from reviewer and no pending Review has subject
  then
    add a new pending Review with subject, requester, reviewer, and requestedAt at
    return review

approve (review: Review, reviewer: Person, at: DateTime) : return (review: Review)
  where review is unknown, is not pending, or does not have reviewer
  then
    refuse REVIEW_NOT_PENDING_FOR_REVIEWER "There is no such pending review for this reviewer."
  where review is pending and has reviewer
  then
    mark the Review approved with decidedAt at
    return review

reject (review: Review, reviewer: Person, reason: String, at: DateTime) : return (review: Review)
  where reason is blank or longer than 500 characters
  then
    refuse INVALID_REJECTION_REASON "A rejection reason must not be blank and must be at most 500 characters."
  where review is unknown, is not pending, or does not have reviewer
  then
    refuse REVIEW_NOT_PENDING_FOR_REVIEWER "There is no such pending review for this reviewer."
  where review is pending and has reviewer and reason is accepted
  then
    mark the Review rejected with reason and decidedAt at
    return review

withdraw (review: Review, requester: Person, at: DateTime) : return (review: Review)
  where review is unknown, is not pending, or does not have requester
  then
    refuse REVIEW_NOT_PENDING_FOR_REQUESTER "There is no such pending review for this requester."
  where review is pending and has requester
  then
    mark the Review withdrawn with decidedAt at
    return review
```

## Queries

```queries
_get (review: Review) : optional (subject: Subject, requester: Person, reviewer: Person, status: ReviewStatus, requestedAt: DateTime, decidedAt?: DateTime, reason?: String)
  answers no row for an unknown Review
_pendingFor (reviewer: Person) : many (review: Review, subject: Subject, requester: Person, requestedAt: DateTime)
  orders rows by requestedAt and then Review identity
_history (subject: Subject) : many (review: Review, requester: Person, reviewer: Person, status: ReviewStatus, requestedAt: DateTime, decidedAt?: DateTime)
  orders rows by requestedAt and then Review identity
```
