<!-- Generated from the Message board assembly. Do not edit. -->
<!-- Manifest producer: @mit-sdg/sync-engine@1.0.0-beta.8; concept specification: sync-engine.concept-specification@1; renderer: @mit-sdg/sync-engine@1.0.0-beta.8. -->

# Message board — assembled read-back

_Assembled by sync-engine from registered concepts and composition. Edit the concept_
_specifications and composition source, then regenerate this file._

## Concepts

### Authenticating

**Purpose.** Establish a username from a password, so an identity claim alone cannot act as
proof of identity.

**Principle.** Ari registers username `ari` with a password. `_registered` then reports `ari`
as registered, and another registration of `ari` is refused.
Authenticating `ari` with the wrong password is refused. The correct password
authenticates Ari as `ari`, returning only the username.

_Registration checks member names, recoverable input names, and refusal mappings._
_Engine-evaluated reads enforce query cardinality. Types, results, and behavior prose are not executable assertions._

#### Actions

##### `register (username: Username, password: Password) : return (username: Username)`

**Authored behavior:**

    where username is not 3 to 32 letters, digits, underscores, or hyphens
    then
      refuse INVALID_USERNAME "A username must contain 3 to 32 letters, numbers, underscores, or hyphens."
    where password is shorter than 8 characters or longer than 128 characters
    then
      refuse WEAK_PASSWORD "A password must contain 8 to 128 characters."
    where username is already registered
    then
      refuse USERNAME_TAKEN "That username is already registered."
    where username and password are accepted
    then
      add a new account with username, a fresh salt, and a verifier derived from password and that salt
      return username

**Registered refusal codes:** `INVALID_USERNAME`, `WEAK_PASSWORD`, `USERNAME_TAKEN`

##### `authenticate (username: Username, password: Password) : return (username: Username)`

**Authored behavior:**

    where username is unknown or password does not verify
    then
      refuse INVALID_CREDENTIALS "The username or password is incorrect."
    where password verifies
    then
      return username

**Registered refusal codes:** `INVALID_CREDENTIALS`

#### Queries

##### `_registered (username: Username) : one (registered: Flag)`

**Authored behavior:**

    answers false for an unknown Username

#### Types

`Username` is a caller-chosen account name. `Password` is transient input.
`Salt` is a fresh per-account value. `Secret` is a one-way verifier derived from
a password and that account's salt.

### Commenting

**Purpose.** Attach authored external content identities to a target in arrival order and
let only the author retract each attachment, so no other author can remove it.

**Principle.** Ari attaches content `reply-42` to target `topic-7` and receives comment
`comment-1`. Bo attaches `reply-43` to the same target. Both attachments are
listed for `topic-7` in arrival order. Bo's attempt to retract `comment-1` is
refused, leaving both attachments. Ari retracts `comment-1`; a second attempt is
refused because the comment is unknown, and only Bo's attachment remains.

_Registration checks member names, recoverable input names, and refusal mappings._
_Engine-evaluated reads enforce query cardinality. Types, results, and behavior prose are not executable assertions._

#### Actions

##### `add (target: Target, author: Author, content: Content) : return (comment: Comment)`

**Authored behavior:**

    then
      add a new comment with target, author, and content
      return comment

##### `retract (comment: Comment, author: Author) : return (comment: Comment)`

**Authored behavior:**

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

**Registered refusal codes:** `COMMENT_NOT_FOUND`, `COMMENT_AUTHOR_MISMATCH`

#### Queries

##### `_for (target: Target) : many (comment: Comment, author: Author, content: Content)`

**Authored behavior:**

    answers in arrival order
    answers no rows for a target with no comments

#### Types

`Comment` is an identity Commenting allocates for each attachment. `Target`,
`Author`, and `Content` are opaque external identities.

### Posting

**Purpose.** Publish authored messages in publication order, so a contribution stays visible
and attributed without depending on an external content store.

**Principle.** Ari publishes "First post" and Bo publishes "Second post." Both posts are listed
in publication order with their authors, and each post can be read by its
identity. Publishing a blank message or one longer than 500 characters is
refused and does not add a post.

_Registration checks member names, recoverable input names, and refusal mappings._
_Engine-evaluated reads enforce query cardinality. Types, results, and behavior prose are not executable assertions._

#### Actions

##### `publish (author: Author, content: String) : return (post: Post)`

**Authored behavior:**

    where content is blank or longer than 500 characters
    then
      refuse INVALID_POST_CONTENT "Post content must not be blank and must be at most 500 characters."
    where content is accepted
    then
      add a new post with author and content
      return post

**Registered refusal codes:** `INVALID_POST_CONTENT`

#### Queries

##### `_all () : many (post: Post, author: Author, content: String)`

**Authored behavior:**

    answers in publication order

##### `_get (post: Post) : optional (author: Author, content: String)`

**Authored behavior:**

    answers no row for an unknown Post

#### Types

`Post` is an identity Posting allocates for each published message. `Author` is
an opaque external identity. A post's `String` content is owned by Posting.

### RequestBoundary

**Purpose.** Let the outside world ask for things and receive answers, so each authored answer belongs to one pending call and failed waits settle without forging one.

**Principle.** A call arrives and becomes pending. An answer travels back once; timeout or abort ends only the wait, while a quiescent interpreter failure returns an opaque internal error.

Actions:

- `request (…)`
- `respond (…)` — may refuse `NOT_PENDING`

### Sessioning

**Purpose.** Keep a short-lived opaque session for an external subject, so temporary access
can end without changing that subject's identity.

**Principle.** Ari starts a session for subject `ari`. Before the session expires, `_active`
returns a row whose subject is `ari`, and `current` resolves the session to
`ari`. Ending the session makes it unknown, so another `current` call is
refused. An invented or expired session is refused in the same way, and
`_active` returns no row for it.

_Registration checks member names, recoverable input names, and refusal mappings._
_Engine-evaluated reads enforce query cardinality. Types, results, and behavior prose are not executable assertions._

#### Actions

##### `start (subject: Subject) : return (session: Session, expiresAt: Time)`

**Authored behavior:**

    then
      delete every expired session
      add a new opaque session for subject expiring 30 minutes from now
      return session and expiresAt

##### `current (session: Session) : return (subject: Subject)`

**Authored behavior:**

    where session is unknown, ended, or expired
    then
      delete the session if it is expired
      refuse UNKNOWN_SESSION "This session is not active."
    where session is active
    then
      return its subject

**Registered refusal codes:** `UNKNOWN_SESSION`

##### `end (session: Session) : return (ended: Flag)`

**Authored behavior:**

    where session is unknown, ended, or expired
    then
      delete the session if it is expired
      refuse UNKNOWN_SESSION "This session is not active."
    where session is active
    then
      delete session
      return ended true

**Registered refusal codes:** `UNKNOWN_SESSION`

#### Queries

##### `_active (session: Session) : optional (subject: Subject, expiresAt: Time)`

**Authored behavior:**

    answers no row for an unknown, ended, or expired Session
    does not delete an expired Session

#### Types

`Session` is an opaque identity allocated by Sessioning. `Subject` is an opaque
external identity. `Time` is an absolute instant.

## Formers

_Formers name result shapes evaluated when asked. The source former owns_
_the authored explanation; this section records the generated shape._

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

```reaction
when RequestBoundary.request (content, path: "/board/comment", requestId, session, target)
then
  Sessioning.current (session)
```

### Board.BoardComments.AddComment:post-exists#2

```reaction
when Sessioning.current (session, subject: username), asked by Board.BoardComments.AddComment
where
  earlier, RequestBoundary.request (content, path: "/board/comment", requestId, session, target)
  Posting._get (post: target)
then
  Commenting.add (author: username, content, target)
```

### Board.BoardComments.AddComment:post-exists#3

```reaction
when Commenting.add (author: username, content, target, comment), asked by Board.BoardComments.AddComment:post-exists#2
where
  earlier, RequestBoundary.request (content, path: "/board/comment", requestId, session, target)
then
  RequestBoundary.respond (comment, requestId)
```

### Board.BoardComments.AddComment:post-missing#2

```reaction
when Sessioning.current (session, subject: username), asked by Board.BoardComments.AddComment
where
  earlier, RequestBoundary.request (content, path: "/board/comment", requestId, session, target)
  no Posting._get (post: target)
then
  RequestBoundary.respond (error: "POST_NOT_FOUND", requestId)
```

### Board.BoardComments.RetractComment

```reaction
when RequestBoundary.request (comment, path: "/board/retract-comment", requestId, session)
then
  Sessioning.current (session)
```

### Board.BoardComments.RetractComment#2

```reaction
when Sessioning.current (session, subject: username), asked by Board.BoardComments.RetractComment
where
  earlier, RequestBoundary.request (comment, path: "/board/retract-comment", requestId, session)
then
  Commenting.retract (author: username, comment)
```

### Board.BoardComments.RetractComment#3

```reaction
when Commenting.retract (author: username, comment), asked by Board.BoardComments.RetractComment#2
where
  earlier, RequestBoundary.request (comment, path: "/board/retract-comment", requestId, session)
then
  RequestBoundary.respond (comment, requestId)
```

### Board.BoardPublishing.PublishPost

```reaction
when RequestBoundary.request (content, path: "/board/post", requestId, session)
then
  Sessioning.current (session)
```

### Board.BoardPublishing.PublishPost#2

```reaction
when Sessioning.current (session, subject: username), asked by Board.BoardPublishing.PublishPost
where
  earlier, RequestBoundary.request (content, path: "/board/post", requestId, session)
then
  Posting.publish (author: username, content)
```

### Board.BoardPublishing.PublishPost#3

```reaction
when Posting.publish (author: username, content, post), asked by Board.BoardPublishing.PublishPost#2
where
  earlier, RequestBoundary.request (content, path: "/board/post", requestId, session)
then
  RequestBoundary.respond (post, requestId)
```

### Board.BoardReading.ListBoard

```reaction
when RequestBoundary.request (path: "/board/list", requestId, session)
then
  Sessioning.current (session)
```

### Board.BoardReading.ListBoard#2

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

```reaction
when RequestBoundary.request (path: "/auth/current", requestId, session)
then
  Sessioning.current (session)
```

### Sessions.CurrentAccount.CurrentUser#2

```reaction
when Sessioning.current (session, subject: username), asked by Sessions.CurrentAccount.CurrentUser
where
  earlier, RequestBoundary.request (path: "/auth/current", requestId, session)
then
  RequestBoundary.respond (requestId, username)
```

### Sessions.EnteringApplication.Register

```reaction
when RequestBoundary.request (password, path: "/auth/register", requestId, username)
then
  Authenticating.register (password, username)
```

### Sessions.EnteringApplication.Register#2

```reaction
when Authenticating.register (password, username), asked by Sessions.EnteringApplication.Register
then
  Sessioning.start (subject: username)
```

### Sessions.EnteringApplication.Register#3

```reaction
when Sessioning.start (subject: username, expiresAt, session), asked by Sessions.EnteringApplication.Register#2
where
  earlier, RequestBoundary.request (password, path: "/auth/register", requestId, username)
then
  RequestBoundary.respond (expiresAt, requestId, session, username)
```

### Sessions.EnteringApplication.SignIn

```reaction
when RequestBoundary.request (password, path: "/auth/sign-in", requestId, username)
then
  Authenticating.authenticate (password, username)
```

### Sessions.EnteringApplication.SignIn#2

```reaction
when Authenticating.authenticate (password, username), asked by Sessions.EnteringApplication.SignIn
then
  Sessioning.start (subject: username)
```

### Sessions.EnteringApplication.SignIn#3

```reaction
when Sessioning.start (subject: username, expiresAt, session), asked by Sessions.EnteringApplication.SignIn#2
where
  earlier, RequestBoundary.request (password, path: "/auth/sign-in", requestId, username)
then
  RequestBoundary.respond (expiresAt, requestId, session, username)
```

### Sessions.LeavingApplication.SignOut

```reaction
when RequestBoundary.request (path: "/auth/sign-out", requestId, session)
then
  Sessioning.end (session)
```

### Sessions.LeavingApplication.SignOut#2

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
