<!-- Generated from the Message board assembly. Do not edit. -->
<!-- Manifest producer: @mit-sdg/sync-engine@1.0.0-beta.7; concept specification: sync-engine.concept-specification@1; renderer: @mit-sdg/sync-engine@1.0.0-beta.7. -->

# Message board — assembled read-back

_Assembled by sync-engine from registered concepts and composition. Edit the concept_
_specifications and composition source, then regenerate this file._

## Concepts

### Authenticating

**Purpose.** Establish a username from a password, so an identity claim alone cannot act as
proof of identity.

**Principle.** Ari registers username `ari` with a password. A duplicate registration is
refused. A wrong password is refused. The right password authenticates Ari as
`ari` without revealing the stored password verifier.

_Registration checks member names, recoverable input names, and refusal mappings._
_Engine-evaluated reads enforce query cardinality. Types, results, and behavior prose are not executable assertions._

#### Actions

##### `register (username: Username, password: Password) : return (username: Username)`

**Authored behavior:**

    where username is malformed
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
      store a password verifier for username
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

### Commenting

**Purpose.** Attach authored external content identities to external targets in arrival order
and let their author retract them, so those associations have a visible lifecycle.

**Principle.** Ari attaches content identity “reply-42” to target “topic-7,” and Bo attaches
“reply-43.” Both attachments are listed in arrival order. Ari retracts the first.
Bo cannot retract Ari's attachment, and retracting an unknown attachment is
refused; either refusal leaves the attachments unchanged.

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

    answers in attachment order

#### Types

`Target`, `Author`, and `Content` are generic external identities. Commenting
owns only their ordered attachment, not the facts identified by those values.

### Posting

**Purpose.** Publish authored string messages in arrival order, so contributions remain visible
without depending on an external content store.

**Principle.** Ari publishes “First post” and Bo publishes “Second post.” Both messages are
listed in publication order with their authors. An empty message is refused and
nothing is added.

_Registration checks member names, recoverable input names, and refusal mappings._
_Engine-evaluated reads enforce query cardinality. Types, results, and behavior prose are not executable assertions._

#### Actions

##### `publish (author: Author, content: String) : return (post: Post)`

**Authored behavior:**

    where content is empty or longer than the accepted message bound
    then
      refuse INVALID_POST_CONTENT "Post content must contain 1 to 500 non-whitespace characters."
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

`Author` is a generic external identity. Posting neither creates nor
authenticates it. `String` content belongs to Posting. Posts are retained
permanently in this small implementation.

### RequestBoundary

**Purpose.** Let the outside world ask for things and receive answers, so each authored answer belongs to one pending call and failed waits settle without forging one.

**Principle.** A call arrives and becomes pending. An answer travels back once; timeout or abort ends only the wait, while a quiescent interpreter failure returns an opaque internal error.

Actions:

- `request (…)`
- `respond (…)` — may refuse `NOT_PENDING`

### Sessioning

**Purpose.** Keep a short-lived opaque session for an external subject, so temporary access
can end without changing that subject's identity.

**Principle.** Ari starts a session for subject `ari`. Before its expiry, the session resolves
to `ari`. Ending it makes it unknown. An invented or expired session is also
refused and does not resolve to a subject.

_Registration checks member names, recoverable input names, and refusal mappings._
_Engine-evaluated reads enforce query cardinality. Types, results, and behavior prose are not executable assertions._

#### Actions

##### `start (subject: Subject) : return (session: Session, expiresAt: Time)`

**Authored behavior:**

    then
      add a new opaque session for subject with a bounded expiry
      return session and expiresAt

##### `current (session: Session) : return (subject: Subject)`

**Authored behavior:**

    where session is unknown, ended, or expired
    then
      delete session if expired
      refuse UNKNOWN_SESSION "This session is not active."
    where session is active
    then
      return its subject

**Registered refusal codes:** `UNKNOWN_SESSION`

##### `end (session: Session) : return (ended: Flag)`

**Authored behavior:**

    where session is unknown, ended, or expired
    then
      delete session if expired
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

`Subject` is a generic external identity. Sessioning stores it without creating
or interpreting it.

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

### AddComment

```reaction
when RequestBoundary.request (content, path: "/board/comment", requestId, session, target)
then
  Sessioning.current (session)
```

### AddComment:post-exists#2

```reaction
when Sessioning.current (session, subject: username), asked by AddComment
where
  earlier, RequestBoundary.request (content, path: "/board/comment", requestId, session, target)
  Posting._get (post: target)
then
  Commenting.add (author: username, content, target)
```

### AddComment:post-exists#3

```reaction
when Commenting.add (author: username, content, target, comment), asked by AddComment:post-exists#2
where
  earlier, RequestBoundary.request (content, path: "/board/comment", requestId, session, target)
then
  RequestBoundary.respond (comment, requestId)
```

### AddComment:post-missing#2

```reaction
when Sessioning.current (session, subject: username), asked by AddComment
where
  earlier, RequestBoundary.request (content, path: "/board/comment", requestId, session, target)
  no Posting._get (post: target)
then
  RequestBoundary.respond (error: "POST_NOT_FOUND", requestId)
```

### CurrentUser

```reaction
when RequestBoundary.request (path: "/auth/current", requestId, session)
then
  Sessioning.current (session)
```

### CurrentUser#2

```reaction
when Sessioning.current (session, subject: username), asked by CurrentUser
where
  earlier, RequestBoundary.request (path: "/auth/current", requestId, session)
then
  RequestBoundary.respond (requestId, username)
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

### ListBoard

```reaction
when RequestBoundary.request (path: "/board/list", requestId, session)
then
  Sessioning.current (session)
```

### ListBoard#2

```reaction
when Sessioning.current (session, subject: username), asked by ListBoard
where
  earlier, RequestBoundary.request (path: "/board/list", requestId, session)
then
  RequestBoundary.respond (board: former "the message board", requestId)
```

### PublishPost

```reaction
when RequestBoundary.request (content, path: "/board/post", requestId, session)
then
  Sessioning.current (session)
```

### PublishPost#2

```reaction
when Sessioning.current (session, subject: username), asked by PublishPost
where
  earlier, RequestBoundary.request (content, path: "/board/post", requestId, session)
then
  Posting.publish (author: username, content)
```

### PublishPost#3

```reaction
when Posting.publish (author: username, content, post), asked by PublishPost#2
where
  earlier, RequestBoundary.request (content, path: "/board/post", requestId, session)
then
  RequestBoundary.respond (post, requestId)
```

### Register

```reaction
when RequestBoundary.request (password, path: "/auth/register", requestId, username)
then
  Authenticating.register (password, username)
```

### Register#2

```reaction
when Authenticating.register (password, username), asked by Register
then
  Sessioning.start (subject: username)
```

### Register#3

```reaction
when Sessioning.start (subject: username, expiresAt, session), asked by Register#2
where
  earlier, RequestBoundary.request (password, path: "/auth/register", requestId, username)
then
  RequestBoundary.respond (expiresAt, requestId, session, username)
```

### SignIn

```reaction
when RequestBoundary.request (password, path: "/auth/sign-in", requestId, username)
then
  Authenticating.authenticate (password, username)
```

### SignIn#2

```reaction
when Authenticating.authenticate (password, username), asked by SignIn
then
  Sessioning.start (subject: username)
```

### SignIn#3

```reaction
when Sessioning.start (subject: username, expiresAt, session), asked by SignIn#2
where
  earlier, RequestBoundary.request (password, path: "/auth/sign-in", requestId, username)
then
  RequestBoundary.respond (expiresAt, requestId, session, username)
```

### SignOut

```reaction
when RequestBoundary.request (path: "/auth/sign-out", requestId, session)
then
  Sessioning.end (session)
```

### SignOut#2

```reaction
when Sessioning.end (session, ended: signedOut), asked by SignOut
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
