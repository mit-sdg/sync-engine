# Ranked Discussion

A ranked discussion keeps responses independent from popularity while presenting each response with its current aggregate score.

## Application types and instances

```types
concrete Subject
  A topic supplied by the discussion application.

concrete Person
  An author or voter identity supplied by the application.
```

```instances
instantiate Timing

instantiate Discussing with
  Subject is Subject
  Author is Person

instantiate Upvoting with
  Item is Discussing.Response
  Voter is Person
```

## Compositions

### DiscussionLifecycle

A discussion may open, receive attributed responses, and close using Timing-owned event times. Applications must bind author identities when attribution matters.

### ResponseVoting

A voter may upvote, downvote, or remove their vote only for a Response that exists; a missing response returns `RESPONSE_NOT_FOUND`. Applications must bind voter identities when one-person-one-vote authority matters.

### DiscussionPages

Opening a discussion presents its responses together with aggregate scores, without exposing voter identities.

## Formers

### RankedResponses

The ranked response read combines Discussing's response details with Upvoting's current score for each Response.
