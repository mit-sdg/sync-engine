# Message board

Message board is a small browser application built with sync-engine. A visitor
can register, sign in, publish posts, attach and retract comments, read the
board, and sign out. It shows how independent behaviors form one web application
without making any concept responsible for the complete workflow.

Start with [Reading Circle](../reading-circle/README.md) if you want the shortest
transport-neutral example. Message board adds authentication, browser sessions,
and the maintained HTTP package.

## Run the browser application

From this directory:

```sh
bun install
bun run start
```

Open <http://localhost:3000>. Set `HOST` or `PORT` to select another listener:

```sh
HOST=127.0.0.1 PORT=4000 bun run start
```

The host serves both the browser UI and the `/api` endpoints. It keeps accounts,
sessions, posts, and comments in memory, so stopping the process clears the
board.

Run the example's checks separately:

```sh
bun run check
```

`check` runs formatting, type checking, tests, and generated-artifact checks.
This example has no standalone command-line scenario; `start` runs the web host
until it is stopped.

## The concepts

A **concept** is one independently meaningful stateful behavior. A concept owns
its own facts and rules, but does not import or name the other concepts in the
application. Message board registers these:

- **Authenticating** owns accounts and username/password verification.
  Registration records a password verifier. Authentication returns a username
  only when the supplied password verifies.
- **Sessioning** owns opaque, expiring sessions for an external subject. It does
  not decide what a subject means or authenticate that subject.
- **Posting** publishes string messages in order. Posting owns each post's text,
  while its `Author` is an external identity supplied by composition.
- **Commenting** records ordered attachments between a `Target`, an `Author`, and
  a `Content` identity. All three are opaque external identities; Commenting
  owns the attachment, not the post, person, or content they identify. Only the
  author who created an attachment may retract it.

Posting and Commenting treat text differently. Posting owns post text. The
browser passes entered comment text to Commenting as a `Content` identity and
renders the returned value verbatim, but Commenting does not own or validate
that text.

Each concept has a specification and direct tests under `src/concepts/`. The
specification states the concept's purpose, actions, queries, and expected
refusals without relying on another concept.

## How composition makes the application

**Composition** contains the application-specific rules that connect concepts.
The sign-in endpoint first asks Authenticating to verify the username and
password. If authentication succeeds, composition passes the returned username
as Sessioning's external subject and asks Sessioning to start a session. The HTTP
boundary stores the resulting opaque session value in a cookie.

Protected endpoints reverse that adaptation. They ask Sessioning for the subject
of the session cookie, bind the returned subject as the current username, and
use that username as Posting's or Commenting's external `Author` identity. A
post or comment request therefore does not choose its own author.

The board read is also composition. A **former** constructs the page-shaped
result by listing Posting's posts and, for each post identity, listing
Commenting's attachments whose target is that post. Before adding a comment, the
endpoint checks that Posting currently has the target post.

A **reaction** responds to one concept action by asking another. These workflows
need the result of each step, so authentication, session resolution, the requested
action, and the response are ordered endpoint stages instead of reactions.

Sessioning owns session expiry and cleanup. A session becomes inactive at its
expiry even if the application is idle. In the in-memory implementation,
`start` removes every expired record before allocating a new session; `current` and
`end` remove an expired record when they encounter it; and `_active` reports an
expired session as absent without removing its record. An expired record can
therefore remain stored until an applicable Sessioning action removes it.
Assembly performs no cleanup initialization, the host schedules no cleanup, and
Sessioning does not guarantee periodic reclamation.

Composition contains the application connections, while each concept retains
its own lifecycle rules.

## Browser and session flow

The browser uses the generated typed client rather than constructing endpoint
requests with raw `fetch` calls. A normal visit follows this lifecycle:

1. Register a username and password, or sign in to an existing account. Either
   operation starts a session and issues an `HttpOnly` cookie.
2. Publish a post or attach a comment. The server obtains the author from the
   session rather than from browser input.
3. List the board. The former combines post state with attached comment state.
   Comments by the current user have a retract button. Hiding the button for
   other comments is a presentation choice; Commenting enforces the author rule.
4. Sign out. Sessioning ends the session and the HTTP boundary clears the
   cookie. If the visitor does not sign out, the session becomes inactive at its
   expiry.

The [technical notes](TECHNICAL.md) describe the endpoint branches, cookie
policy, runtime validation, failure boundaries, generated wire projection, and
test evidence.

## Source map

| Path                                                       | Role                                                         |
| ---------------------------------------------------------- | ------------------------------------------------------------ |
| `src/concepts/*/`                                          | Concept specifications, implementations, and principle tests |
| `src/compositions/sessions.ts`                             | Registration, sign-in, current-user, and sign-out endpoints  |
| `src/compositions/board.ts`                                | Board former and the post, comment, and retract endpoints    |
| `src/compositions/validators.ts`                           | Runtime endpoint validators shared by both modules           |
| `src/assembly.ts`                                          | Concept assembly and execution limits                        |
| `src/edge.ts`                                              | Gateway, HTTP policy, cookie binding, and Fetch handler      |
| `src/client.ts`                                            | Typed projected HTTP client                                  |
| `src/host.ts`, `src/web/`                                  | Bun host and browser UI                                      |
| `tests/`                                                   | Network lifecycle, security, artifact, and type checks       |
| [`generated/message-board.md`](generated/message-board.md) | Pinned assembled read-back                                   |
| [`generated/wire.ts`](generated/wire.ts)                   | Pinned logical and browser-projected contracts               |

Continue with [Designing with concepts](../../docs/user/design.md) for concept
boundaries and composition criteria, or the [application model](../../docs/user/overview.md)
for the roles of assembly, endpoints, formers, gateways, and clients.
