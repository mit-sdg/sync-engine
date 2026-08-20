# Commenting

## Purpose

Attach authored comments to an external target and let only the author retract each
comment, so discussion can accumulate without allowing one author to erase another's
contribution.

## Principle

Ari adds "First reply" to target `topic-7` and Bo adds "Second reply" later. Both
comments are listed in chronological order. Bo cannot retract Ari's comment. Ari
retracts it; a second retraction is refused, and only Bo's comment remains.

## Types

```types
external Target
  The object receiving a comment.
external Author
  The identity that authored a comment.
```

## State

```state
a seq of Comments with
  a target Target
  an author Author
  a text String
  an addedAt DateTime
```

## Actions

```actions
add (target: Target, author: Author, text: String, at: DateTime) : return (comment: Comment)
  where text is blank or longer than 1000 characters
  then
    refuse INVALID_COMMENT_TEXT "A comment must not be blank and must be at most 1000 characters."
  where text is accepted
  then
    add a new Comment with target, author, text, and addedAt at
    return comment

retract (comment: Comment, author: Author) : return (comment: Comment)
  where comment is unknown
  then
    refuse COMMENT_NOT_FOUND "There is no such comment."
  where comment is known and does not have author
  then
    refuse COMMENT_AUTHOR_MISMATCH "Only the comment author may retract it."
  where comment is known and has author
  then
    delete the Comment
    return comment
```

## Queries

```queries
_for (target: Target) : many (comment: Comment, author: Author, text: String, addedAt: DateTime)
  answers the Target's Comments with their authors, text, and added times
  answers no rows for a Target with no Comments
  orders rows by addedAt and then Comment identity
_get (comment: Comment) : optional (target: Target, author: Author, text: String, addedAt: DateTime)
  answers the Comment's target, author, text, and added time
  answers no row for an unknown Comment
```
