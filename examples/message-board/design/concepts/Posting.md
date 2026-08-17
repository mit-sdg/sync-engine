# Posting

## Purpose

Publish authored messages in publication order, so a contribution stays visible
and attributed without depending on an external content store.

## Principle

Ari publishes "First post" and Bo publishes "Second post." Both posts are listed
in publication order with their authors, and each post can be read by its
identity. Publishing a blank message or one longer than 500 characters is
refused and does not add a post.

## Types

```types
external Author
  The identity that authored the post.
```

## State

```state
a seq of Posts with
  an author Author
  a content String

alias Post for Posts
```

## Actions

```actions
publish (author: Author, content: String) : return (post: Post)
  where content is blank or longer than 500 characters
  then
    refuse INVALID_POST_CONTENT "Post content must not be blank and must be at most 500 characters."
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
