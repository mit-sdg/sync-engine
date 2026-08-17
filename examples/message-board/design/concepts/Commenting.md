# Commenting

## Purpose

Attach authored external content identities to a target in arrival order and
let only the author retract each attachment, so no other author can remove it.

## Principle

Ari attaches content `reply-42` to target `topic-7` and receives comment
`comment-1`. Bo attaches `reply-43` to the same target. Both attachments are
listed for `topic-7` in arrival order. Bo's attempt to retract `comment-1` is
refused, leaving both attachments. Ari retracts `comment-1`; a second attempt is
refused because the comment is unknown, and only Bo's attachment remains.

## Types

```types
external Target
  The object receiving the attachment.
external Author
  The identity that authored the attachment.
external Content
  The externally owned content attached to the target.
```

## State

```state
a seq of Comments with
  a target Target
  an author Author
  a content Content
```

## Actions

```actions
add (target: Target, author: Author, content: Content) : return (comment: Comment)
  where true
  then
    add a new comment with target, author, and content
    return comment

retract (comment: Comment, author: Author) : return (comment: Comment)
  where comment is unknown
  then
    refuse COMMENT_NOT_FOUND "There is no such comment."
  where comment is known and author does not match its author
  then
    refuse COMMENT_AUTHOR_MISMATCH "Only the comment author may retract it."
  where comment is known and author matches its author
  then
    delete comment
    return comment
```

## Queries

```queries
_for (target: Target) : many (comment: Comment, author: Author, content: Content)
  answers in arrival order
  answers no rows for a target with no comments
```
