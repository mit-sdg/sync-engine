# Posting

## Purpose

Publish immutable authored messages in chronological order, so a contribution remains
visible and attributed without depending on an external content store.

## Principle

Ari publishes "First post" at `t1` and Bo publishes "Second post" at `t2`. Both posts
are listed in that order with their authors, and each post is readable by identity.
Publishing a blank message or one longer than 500 characters is refused and creates no
Post.

## State

```state
a seq of Posts with
  an author Author
  a content String
  a publishedAt DateTime
```

## Actions

```actions
publish (author: Author, content: String, at: DateTime) : return (post: Post)
  where content is blank or longer than 500 characters
  then
    refuse INVALID_POST_CONTENT "Post content must not be blank and must be at most 500 characters."
  where content is accepted
  then
    add a new Post with author, content, and publishedAt at
    return post
```

## Queries

```queries
_all () : many (post: Post, author: Author, content: String, publishedAt: DateTime)
  orders rows by publishedAt and then Post identity
_get (post: Post) : optional (author: Author, content: String, publishedAt: DateTime)
  answers no row for an unknown Post
_byAuthor (author: Author) : many (post: Post, content: String, publishedAt: DateTime)
  orders rows by publishedAt and then Post identity
```

## Types

`Post` is an identity allocated by Posting. `Author` is an opaque external identity.
`String` is owned text. `DateTime` is an absolute instant.
