# Upvoting

## Purpose

Record one current preference from each voter about an item, so an aggregate score
reflects distinct voters rather than repeated clicks.

## Principle

Ari upvotes proposal `p1`, giving it score 1. Bo downvotes `p1`, returning the score to 0. Ari changes the vote to down, making the score -2 without creating a second vote.
A second downvote from Ari is refused. Ari unvotes, leaving Bo's downvote and score -1;
a second unvote is refused.

## State

```state
a set of Votes with
  an item Item
  a voter Voter
  a direction Direction

at most one Vote has each item and voter pair
```

## Actions

```actions
upvote (item: Item, voter: Voter) : return (item: Item, voter: Voter)
  where the current Vote for item and voter is up
  then
    refuse ALREADY_UPVOTED "This voter has already upvoted the item."
  where the current Vote for item and voter is down
  then
    change that Vote to up
    return item and voter
  where there is no Vote for item and voter
  then
    add an up Vote for item and voter
    return item and voter

downvote (item: Item, voter: Voter) : return (item: Item, voter: Voter)
  where the current Vote for item and voter is down
  then
    refuse ALREADY_DOWNVOTED "This voter has already downvoted the item."
  where the current Vote for item and voter is up
  then
    change that Vote to down
    return item and voter
  where there is no Vote for item and voter
  then
    add a down Vote for item and voter
    return item and voter

unvote (item: Item, voter: Voter) : return (item: Item, voter: Voter)
  where there is no Vote for item and voter
  then
    refuse VOTE_NOT_FOUND "This voter has no vote for the item."
  where there is a Vote for item and voter
  then
    delete that Vote
    return item and voter
```

## Queries

```queries
_vote (item: Item, voter: Voter) : optional (direction: Direction)
  answers no row when the voter has not voted on the item
_score (item: Item) : one (score: Integer)
  answers the number of up Votes minus the number of down Votes
  answers 0 for an Item with no Votes
```

## Types

`Item` and `Voter` are opaque external identities. `Direction` is the value `up` or
`down`. `Integer` is a signed whole number.
