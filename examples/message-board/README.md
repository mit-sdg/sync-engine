# Message board

Message board is a small application built with sync-engine. Its application
constructor has no HTTP policy. Two Bun hosts bind the same application to a
Fetch handler: one exposes a plain POST/JSON API, while the other adds a
cookie-backed browser session and serves the browser assets.

A visitor can register, sign in, publish posts, attach comments, read the board,
and sign out. The example shows how four independent stateful behaviors become
one application without making any one behavior responsible for the whole
workflow. Start with [Reading Circle](../reading-circle/README.md) for the
shortest transport-neutral example.

## Run the browser deployment

From this directory:

```sh
bun install
bun run start
```

Open <http://localhost:3000>. The Bun host serves the browser UI and routes
`/api/*` requests to the Fetch handler. The handler issues and reads the session
cookie; Bun owns the listener, static assets, and process lifecycle.

Set `HOST` or `PORT` to select another listener. Set `PUBLIC_ORIGIN` when the URL
used by callers differs from the origin derived from `HOST` and `PORT`:

```sh
HOST=127.0.0.1 PORT=4000 PUBLIC_ORIGIN=http://127.0.0.1:4000 bun run start
```

`HOST` must be nonempty, `PORT` must be an integer from 1 through 65535, and
`PUBLIC_ORIGIN` must be an absolute HTTP or HTTPS origin without credentials,
path, query, or fragment. Invalid values terminate startup before `Bun.serve`.
This host serves the frontend and API from one origin. It does not configure
CORS for a frontend on another origin.

## Run the plain POST/JSON API

Use the API-only host when every endpoint input, including the session value, is
carried in JSON:

```sh
bun run start:api
```

The API listens at <http://localhost:3000/api> by default. It serves no frontend
assets, emits no cookie or CORS headers, and returns `session` and `expiresAt`
from successful registration and sign-in calls. Send the returned `session` in
the JSON body of current-user, sign-out, board-list, post, and comment requests.
The cookie-projected `MessageBoardWireHttp` client is for the browser deployment;
the plain API retains the session fields in the logical `MessageBoardWire`.

`HOST` and `PORT` select another API listener. The plain host does not read
`PUBLIC_ORIGIN` because it has no cookie or browser policy.

Both hosts keep accounts, sessions, posts, and comments in memory. Stopping a
host clears its board. Run the checks separately:

```sh
bun run check
```

`check` runs formatting, type checking, tests, and generated-artifact checks.
The example has no standalone command-line scenario; each start command runs its
host until stopped.

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

## Application construction and HTTP binding

`createMessageBoard()` in `src/application.ts` assembles the concepts and
composition, applies execution limits to a gateway, and returns
`{ application, gateway }`. The function imports no HTTP package code and
selects no cookie, CORS, origin, listener, or static-file policy. Direct callers
and other transports can use the same application and gateway.

`src/edge.ts` defines two deployment policies. `messageBoardApiPolicy()` adds
only `/api` and reviewed public error mappings. `messageBoardHttpPolicy(...)`
also binds the logical `session` input and registration and sign-in outputs to a secure cookie.
Each host passes its selected policy, application, and gateway to
`createHttpHandler(...)` from `@mit-sdg/sync-engine-http/handler`.

`src/api-host.ts` gives that Fetch handler directly to `Bun.serve`.
`src/host.ts` wraps the handler with routing for the browser HTML and JavaScript.
The HTTP package owns protocol behavior inside the handler; Bun owns both
listeners and the browser host owns static-file routing.

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

1. Register a username and password. Successful registration starts a session
   and issues an `HttpOnly` cookie. Sign-in performs the same session step for an
   existing account.
2. Publish a post or attach a comment. The Fetch handler obtains the session
   from the cookie, and composition obtains the author from that session rather
   than from browser input.
3. List the board. The former combines post state with attached comment state.
4. Sign out. Sessioning ends the session and the HTTP boundary clears the
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
| `src/application.ts`                                       | Policy-independent application and gateway construction      |
| `src/edge.ts`                                              | Plain and cookie-backed HTTP policies                        |
| `src/api-host.ts`                                          | Bun host for the plain POST/JSON API                         |
| `src/client.ts`                                            | Typed cookie-projected HTTP client                           |
| `src/host.ts`, `src/web/`                                  | Bun browser host, static routing, and browser UI             |
| `tests/`                                                   | Network lifecycle, security, artifact, and type checks       |
| [`generated/message-board.md`](generated/message-board.md) | Pinned assembled read-back                                   |
| [`generated/wire.ts`](generated/wire.ts)                   | Pinned logical and browser-projected contracts               |

Continue with [Designing with concepts](../../docs/user/design.md) for concept
boundaries and composition criteria, or the [application model](../../docs/user/overview.md)
for the roles of assembly, endpoints, formers, gateways, and clients.
