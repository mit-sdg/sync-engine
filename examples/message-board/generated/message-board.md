<!-- Generated from the Message board assembly. Do not edit. -->
<!-- Manifest producer: @mit-sdg/sync-engine@1.0.0-beta.10; concept specification: sync-engine.concept-specification@1; renderer: @mit-sdg/sync-engine@1.0.0-beta.10. -->

# Message board — assembled read-back

_Assembled by sync-engine from registered concepts and composition. Edit the concept_
_specifications and composition source, then regenerate this file._

## Concepts

### Authenticating

Defined in [Authenticating](../design/concepts/Authenticating.md), line 1.

#### Actions

- `register(username: Username, password: Password) : return (username: Username)`
  - Refuses `INVALID_USERNAME`: A username must contain 3 to 32 letters, numbers, underscores, or hyphens.
  - Refuses `WEAK_PASSWORD`: A password must contain 8 to 128 characters.
  - Refuses `USERNAME_TAKEN`: That username is already registered.
- `authenticate(username: Username, password: Password) : return (username: Username)`
  - Refuses `INVALID_CREDENTIALS`: The username or password is incorrect.

#### Queries

- `_registered(username: Username) : one (registered: Flag)`

#### Selected instances and bindings

- `Authenticating`

### Commenting

Defined in [Commenting](../design/concepts/Commenting.md), line 1.

#### Actions

- `add(target: Target, author: Author, content: Content) : return (comment: Comment)`
- `retract(comment: Comment, author: Author) : return (comment: Comment)`
  - Refuses `COMMENT_NOT_FOUND`: There is no such comment.
  - Refuses `COMMENT_AUTHOR_MISMATCH`: Only the comment author may retract it.

#### Queries

- `_for(target: Target) : many (comment: Comment, author: Author, content: Content)`

#### Selected instances and bindings

- `Commenting`
  - `Commenting.Author` is `Authenticating.Username` — [Message Board Application Types](../design/types.md), line 18.
  - `Commenting.Target` is `Posting.Post` — [Message Board Application Types](../design/types.md), line 21.
  - `Commenting.Content` is `CommentContent` — [Message Board Application Types](../design/types.md), line 24.

### Posting

Defined in [Posting](../design/concepts/Posting.md), line 1.

#### Actions

- `publish(author: Author, content: String) : return (post: Post)`
  - Refuses `INVALID_POST_CONTENT`: Post content must not be blank and must be at most 500 characters.

#### Queries

- `_all() : many (post: Post, author: Author, content: String)`
- `_get(post: Post) : optional (author: Author, content: String)`

#### Selected instances and bindings

- `Posting`
  - `Posting.Author` is `Authenticating.Username` — [Message Board Application Types](../design/types.md), line 15.

### Sessioning

Defined in [Sessioning](../design/concepts/Sessioning.md), line 1.

#### Actions

- `start(subject: Subject) : return (session: Session, expiresAt: Time)`
- `current(session: Session) : return (subject: Subject)`
  - Refuses `UNKNOWN_SESSION`: This session is not active.
- `end(session: Session) : return (ended: Flag)`
  - Refuses `UNKNOWN_SESSION`: This session is not active.

#### Queries

- `_active(session: Session) : optional (subject: Subject, expiresAt: Time)`

#### Selected instances and bindings

- `Sessioning`
  - `Sessioning.Subject` is `Authenticating.Username` — [Message Board Application Types](../design/types.md), line 12.

## Application types

Concrete types:

- `CommentContent` — [Message Board Application Types](../design/types.md), line 9.

## Formers

_Formers name result shapes evaluated when asked. The source former owns_
_the authored explanation; this section records the generated shape._

### the message board

Authored path: `Board.BoardReading.Board`.
- Covered by [Board](../design/compositions/Board.md), line 9.

```former
Former "the message board" — inputs (); bindings (post, author, content, comment, commentAuthor, commentContent); promises exactly one record — forms:
  a record of
    posts: each Posting._all () has (author, content, post)
      form a record of
        author
        comments: each Commenting._for (target: post) has (author: commentAuthor, comment, content: commentContent)
          form a record of
            author: commentAuthor
            comment
            content: commentContent
        content
        post
```

## Reactions

### Board.BoardComments.AddComment

Authored path: `Board.BoardComments.AddComment`.
- Covered by [Board](../design/compositions/Board.md), line 19.

```reaction
when RequestBoundary.request (content, path: "/board/comment", requestId, session, target)
then
  Sessioning.current (session)
```

### Board.BoardComments.AddComment:post-exists#2

Authored path: `Board.BoardComments.AddComment`.
- Covered by [Board](../design/compositions/Board.md), line 19.

```reaction
when Sessioning.current (session, subject: username), asked by Board.BoardComments.AddComment
where
  earlier, RequestBoundary.request (content, path: "/board/comment", requestId, session, target)
  Posting._get (post: target)
then
  Commenting.add (author: username, content, target)
```

### Board.BoardComments.AddComment:post-exists#3

Authored path: `Board.BoardComments.AddComment`.
- Covered by [Board](../design/compositions/Board.md), line 19.

```reaction
when Commenting.add (author: username, content, target, comment), asked by Board.BoardComments.AddComment:post-exists#2
where
  earlier, RequestBoundary.request (content, path: "/board/comment", requestId, session, target)
then
  RequestBoundary.respond (comment, requestId)
```

### Board.BoardComments.AddComment:post-missing#2

Authored path: `Board.BoardComments.AddComment`.
- Covered by [Board](../design/compositions/Board.md), line 19.

```reaction
when Sessioning.current (session, subject: username), asked by Board.BoardComments.AddComment
where
  earlier, RequestBoundary.request (content, path: "/board/comment", requestId, session, target)
  no Posting._get (post: target)
then
  RequestBoundary.respond (error: "POST_NOT_FOUND", requestId)
```

### Board.BoardComments.RetractComment

Authored path: `Board.BoardComments.RetractComment`.
- Covered by [Board](../design/compositions/Board.md), line 22.

```reaction
when RequestBoundary.request (comment, path: "/board/retract-comment", requestId, session)
then
  Sessioning.current (session)
```

### Board.BoardComments.RetractComment#2

Authored path: `Board.BoardComments.RetractComment`.
- Covered by [Board](../design/compositions/Board.md), line 22.

```reaction
when Sessioning.current (session, subject: username), asked by Board.BoardComments.RetractComment
where
  earlier, RequestBoundary.request (comment, path: "/board/retract-comment", requestId, session)
then
  Commenting.retract (author: username, comment)
```

### Board.BoardComments.RetractComment#3

Authored path: `Board.BoardComments.RetractComment`.
- Covered by [Board](../design/compositions/Board.md), line 22.

```reaction
when Commenting.retract (author: username, comment), asked by Board.BoardComments.RetractComment#2
where
  earlier, RequestBoundary.request (comment, path: "/board/retract-comment", requestId, session)
then
  RequestBoundary.respond (comment, requestId)
```

### Board.BoardPublishing.PublishPost

Authored path: `Board.BoardPublishing.PublishPost`.
- Covered by [Board](../design/compositions/Board.md), line 14.

```reaction
when RequestBoundary.request (content, path: "/board/post", requestId, session)
then
  Sessioning.current (session)
```

### Board.BoardPublishing.PublishPost#2

Authored path: `Board.BoardPublishing.PublishPost`.
- Covered by [Board](../design/compositions/Board.md), line 14.

```reaction
when Sessioning.current (session, subject: username), asked by Board.BoardPublishing.PublishPost
where
  earlier, RequestBoundary.request (content, path: "/board/post", requestId, session)
then
  Posting.publish (author: username, content)
```

### Board.BoardPublishing.PublishPost#3

Authored path: `Board.BoardPublishing.PublishPost`.
- Covered by [Board](../design/compositions/Board.md), line 14.

```reaction
when Posting.publish (author: username, content, post), asked by Board.BoardPublishing.PublishPost#2
where
  earlier, RequestBoundary.request (content, path: "/board/post", requestId, session)
then
  RequestBoundary.respond (post, requestId)
```

### Board.BoardReading.ListBoard

Authored path: `Board.BoardReading.ListBoard`.
- Covered by [Board](../design/compositions/Board.md), line 7.

```reaction
when RequestBoundary.request (path: "/board/list", requestId, session)
then
  Sessioning.current (session)
```

### Board.BoardReading.ListBoard#2

Authored path: `Board.BoardReading.ListBoard`.
- Covered by [Board](../design/compositions/Board.md), line 7.

```reaction
when Sessioning.current (session, subject: username), asked by Board.BoardReading.ListBoard
where
  earlier, RequestBoundary.request (path: "/board/list", requestId, session)
then
  RequestBoundary.respond (board: former "the message board", requestId)
```

### DeliverFaultToAsker

```reaction
when any action is faulted, not asked by DeliverFaultToAsker
where
  earlier, RequestBoundary.request (requestId)
then
  RequestBoundary.respondFramework (error: "INTERNAL_ERROR", requestId)
```

### DeliverRefusalToAsker

```reaction
when any action is refused (message), except RequestBoundary
where
  earlier, RequestBoundary.request (requestId)
then
  RequestBoundary.respond (error: message, requestId)
```

### Sessions.CurrentAccount.CurrentUser

Authored path: `Sessions.CurrentAccount.CurrentUser`.
- Covered by [Sessions](../design/compositions/Sessions.md), line 11.

```reaction
when RequestBoundary.request (path: "/auth/current", requestId, session)
then
  Sessioning.current (session)
```

### Sessions.CurrentAccount.CurrentUser#2

Authored path: `Sessions.CurrentAccount.CurrentUser`.
- Covered by [Sessions](../design/compositions/Sessions.md), line 11.

```reaction
when Sessioning.current (session, subject: username), asked by Sessions.CurrentAccount.CurrentUser
where
  earlier, RequestBoundary.request (path: "/auth/current", requestId, session)
then
  RequestBoundary.respond (requestId, username)
```

### Sessions.EnteringApplication.Register

Authored path: `Sessions.EnteringApplication.Register`.
- Covered by [Sessions](../design/compositions/Sessions.md), line 6.

```reaction
when RequestBoundary.request (password, path: "/auth/register", requestId, username)
then
  Authenticating.register (password, username)
```

### Sessions.EnteringApplication.Register#2

Authored path: `Sessions.EnteringApplication.Register`.
- Covered by [Sessions](../design/compositions/Sessions.md), line 6.

```reaction
when Authenticating.register (password, username), asked by Sessions.EnteringApplication.Register
then
  Sessioning.start (subject: username)
```

### Sessions.EnteringApplication.Register#3

Authored path: `Sessions.EnteringApplication.Register`.
- Covered by [Sessions](../design/compositions/Sessions.md), line 6.

```reaction
when Sessioning.start (subject: username, expiresAt, session), asked by Sessions.EnteringApplication.Register#2
where
  earlier, RequestBoundary.request (password, path: "/auth/register", requestId, username)
then
  RequestBoundary.respond (expiresAt, requestId, session, username)
```

### Sessions.EnteringApplication.SignIn

Authored path: `Sessions.EnteringApplication.SignIn`.
- Covered by [Sessions](../design/compositions/Sessions.md), line 7.

```reaction
when RequestBoundary.request (password, path: "/auth/sign-in", requestId, username)
then
  Authenticating.authenticate (password, username)
```

### Sessions.EnteringApplication.SignIn#2

Authored path: `Sessions.EnteringApplication.SignIn`.
- Covered by [Sessions](../design/compositions/Sessions.md), line 7.

```reaction
when Authenticating.authenticate (password, username), asked by Sessions.EnteringApplication.SignIn
then
  Sessioning.start (subject: username)
```

### Sessions.EnteringApplication.SignIn#3

Authored path: `Sessions.EnteringApplication.SignIn`.
- Covered by [Sessions](../design/compositions/Sessions.md), line 7.

```reaction
when Sessioning.start (subject: username, expiresAt, session), asked by Sessions.EnteringApplication.SignIn#2
where
  earlier, RequestBoundary.request (password, path: "/auth/sign-in", requestId, username)
then
  RequestBoundary.respond (expiresAt, requestId, session, username)
```

### Sessions.LeavingApplication.SignOut

Authored path: `Sessions.LeavingApplication.SignOut`.
- Covered by [Sessions](../design/compositions/Sessions.md), line 15.

```reaction
when RequestBoundary.request (path: "/auth/sign-out", requestId, session)
then
  Sessioning.end (session)
```

### Sessions.LeavingApplication.SignOut#2

Authored path: `Sessions.LeavingApplication.SignOut`.
- Covered by [Sessions](../design/compositions/Sessions.md), line 15.

```reaction
when Sessioning.end (session, ended: signedOut), asked by Sessions.LeavingApplication.SignOut
where
  earlier, RequestBoundary.request (path: "/auth/sign-out", requestId, session)
then
  RequestBoundary.respond (requestId, signedOut)
```

## Endpoint input contracts

Before recording an action ask, the boundary rejects a body that is not an
object or lacks a required key. The response uses `INVALID_INPUT` and names
the path or missing key. A declared default fills an absent key. Endpoints
not listed here have no explicit input contract.

- `/auth/current` — requires `session`
- `/auth/register` — requires `username`, `password`
- `/auth/sign-in` — requires `username`, `password`
- `/auth/sign-out` — requires `session`
- `/board/comment` — requires `session`, `target`, `content`
- `/board/list` — requires `session`
- `/board/post` — requires `session`, `content`
- `/board/retract-comment` — requires `session`, `comment`
