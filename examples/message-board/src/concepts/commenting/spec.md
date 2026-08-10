# Commenting

## Purpose

Attach authored external content identities to external targets in arrival order
and let their author retract them, so those associations have a visible lifecycle.

## Principle

Ari attaches content identity “reply-42” to target “topic-7,” and Bo attaches
“reply-43.” Both attachments are listed in arrival order. Ari retracts the first.
Bo cannot retract Ari's attachment, and retracting an unknown attachment is
refused; either refusal leaves the attachments unchanged.

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
  answers in attachment order
```

## Types

`Target`, `Author`, and `Content` are generic external identities. Commenting
owns only their ordered attachment, not the facts identified by those values.
