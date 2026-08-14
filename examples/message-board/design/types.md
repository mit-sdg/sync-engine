# Message Board Application Types

The board uses account usernames wherever another concept needs an author or
session subject. Comments attach directly to post identities. Comment bodies are
application-supplied text because Commenting deliberately treats their content
as opaque.

```types
concrete CommentContent
  Text supplied by a signed-in account for a comment.

Sessioning.Subject is Authenticating.Username
  A session identifies the account username whose credentials were accepted.

Posting.Author is Authenticating.Username
  Published posts are attributed to account usernames.

Commenting.Author is Authenticating.Username
  Comments are attributed to account usernames.

Commenting.Target is Posting.Post
  Every board comment attaches to a published post.

Commenting.Content is CommentContent
  The board stores comment text as Commenting's opaque content value.
```
