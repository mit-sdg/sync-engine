# Message board

Message board is a small browser application built with sync-engine. A visitor
can register, sign in, publish posts, attach comments, read the board, and sign
out. The example shows how four independent stateful behaviors become one web
application without making any one behavior responsible for the whole workflow.

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

## The four concepts

A **concept** is one independently meaningful stateful behavior. A concept owns
its own facts and rules, but does not import or name the other concepts in the
application. Message board registers four:

- **Authenticating** owns accounts and username/password verification.
  Registration records a password verifier. Authentication returns a username
  only when the supplied password verifies.
- **Sessioning** owns opaque, expiring sessions for an external subject. It does
  not decide what a subject means or authenticate that subject.
- **Posting** publishes string messages in order. Posting owns each post's text,
  while its `Author` is an external identity supplied by composition.
- **Commenting** records ordered attachments between a `Target`, an `Author`, and
  a `Content` identity. All three are generic external identities; Commenting
  owns the attachment, not the post, person, or content they identify.

The last distinction is visible in the browser. The UI passes the entered
comment string as Commenting's `Content` identity and displays that runtime
string verbatim. This adaptation makes a usable demonstration, but it does not
change Commenting into the owner of comment text. Posting, by contrast,
explicitly owns its post strings.

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

A **reaction** is sync-engine's general mechanism for responding to one concept
action by asking another action. This application declares no reactions. Its
cross-concept decisions are ordered stages inside endpoint workflows:
authenticate, start or resolve a session, perform the requested action, and
respond. Keeping that sequence in composition leaves all four concepts usable
and testable on their own.

## Browser and session flow

The browser uses the generated typed client rather than constructing endpoint
requests with raw `fetch` calls. A normal visit follows this lifecycle:

1. Register a username and password.
2. Sign in. Successful sign-in starts a session and issues an `HttpOnly` cookie.
3. Publish a post or attach a comment. The server obtains the author from the
   session rather than from browser input.
4. List the board. The former combines post state with attached comment state.
5. Sign out. Sessioning ends the session and the HTTP boundary clears the
   cookie.

The [technical notes](TECHNICAL.md) describe the endpoint branches, cookie
policy, runtime validation, failure boundaries, generated wire projection, and
test evidence.

## Source map

| Path                                                       | Role                                                         |
| ---------------------------------------------------------- | ------------------------------------------------------------ |
| `src/concepts/*/`                                          | Concept specifications, implementations, and principle tests |
| `src/composition.ts`                                       | Endpoint workflows, runtime validators, and board former     |
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
