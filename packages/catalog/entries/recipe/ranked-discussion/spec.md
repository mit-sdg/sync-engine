# Ranked Discussion

## Purpose

Collect responses independently from popularity and show each response with its
current aggregate vote score.

## Concepts

Timing timestamps discussion activity. Discussing owns Discussions and Responses.
Upvoting owns each Voter's stance on a Response identity used as its Item.

## Decisions

A vote is accepted only when the Response exists. The recipe exposes aggregate scores
but not voter identities. Author and Voter identities must be bound by the containing
application when attribution or one-person-one-vote matters.

## Compositions

- `OpenRankedDiscussion` — `/ranked-discussions/open`
- `RespondToDiscussion` — `/ranked-discussions/respond`
- `UpvoteResponse` — `/ranked-discussions/upvote`
- `DownvoteResponse` — `/ranked-discussions/downvote`
- `UnvoteResponse` — `/ranked-discussions/unvote`
- `CloseRankedDiscussion` — `/ranked-discussions/close`
- `GetRankedDiscussion` — `/ranked-discussions/get`

## Formers

`rankedResponses`.
