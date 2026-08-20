# Message Board Application Types

The board uses account usernames wherever another concept needs an author or
session subject. Comments attach directly to post identities. Comment bodies are
application-supplied text because Commenting deliberately treats their content
as opaque.

The bindings preserve these application decisions:

- A session identifies the account username whose credentials were accepted.
- Published posts are attributed to account usernames.
- Comments are attributed to account usernames.
- Every board comment attaches to a published post.
- The board stores comment text as Commenting's opaque content value.

```types
concrete CommentContent
  Text supplied by a signed-in account for a comment.
```

```instances
instantiate Authenticating

instantiate Sessioning with
  Subject is Authenticating.Account

instantiate Posting with
  Author is Authenticating.Account

instantiate Commenting with
  Author is Authenticating.Account
  Target is Posting.Post
  Content is CommentContent
```
