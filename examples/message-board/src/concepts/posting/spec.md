# Posting

## Purpose

Publish authored string messages in arrival order, so contributions remain visible
without depending on an external content store.

## Principle

Ari publishes “First post” and Bo publishes “Second post.” Both messages are
listed in publication order with their authors. An empty message is refused and
nothing is added.

## State

```state
a seq of Posts with
  an author Author
  a content String
```

## Actions

```actions
publish (author: Author, content: String) : return (post: Post)
  where content is empty or longer than the accepted message bound
  then
    refuse INVALID_POST_CONTENT "Post content must contain 1 to 500 non-whitespace characters."
  where content is accepted
  then
    add a new post with author and content
    return post
```

## Queries

```queries
_all () : many (post: Post, author: Author, content: String)
  answers in publication order
_get (post: Post) : optional (author: Author, content: String)
  answers no row for an unknown Post
```

## Types

`Author` is a generic external identity. Posting neither creates nor
authenticates it. `String` content belongs to Posting. Posts are retained
permanently in this small implementation.
