# Message Board

Message Board is a web app for creating an account, signing in, publishing
posts, commenting, retracting your own comments, and signing out. It runs the
same sync-engine application behind two Bun hosts: a web deployment with
cookie-backed sessions and a plain POST/JSON API whose callers carry the session
value themselves.

Accounts, sessions, posts, and comments remain in memory. Stopping either host
clears the board.

## Run the web app

From this directory:

```sh
bun install
bun run start
```

Open <http://localhost:3000>. The host serves the web app and handles `/api/*`
requests on the same origin.

Set `HOST` or `PORT` to select another listener. Set `PUBLIC_ORIGIN` when callers
use an origin different from the one implied by `HOST` and `PORT`:

```sh
HOST=127.0.0.1 PORT=4000 PUBLIC_ORIGIN=http://127.0.0.1:4000 bun run start
```

`PUBLIC_ORIGIN` must be an absolute HTTP or HTTPS origin without credentials,
path, query, or fragment. The example does not configure CORS for a frontend on
another origin.

## Run the plain JSON API

```sh
bun run start:api
```

The API listens at <http://localhost:3000/api> by default. Registration and
sign-in return `session` and `expiresAt`. Send that `session` in the JSON body of
current-user, sign-out, board-list, post, comment, and comment-retraction
requests. This host serves no frontend, reads no cookies, and emits no cookie or
CORS headers.

## Application workflow

The web app follows this sequence:

1. Registration creates an account and starts a session. Sign-in starts another
   session for an existing account.
2. Posting and commenting resolve the session to the current username. Requests
   cannot choose their own author.
3. Listing the board combines posts with their comments. The web app offers a
   retract button for the current user's comments; Commenting enforces the same
   author rule for every caller.
4. Sign-out ends the session and clears its cookie. A session also becomes
   inactive 30 minutes after it starts.

Four independent concepts own this behavior:

- **Authenticating** owns accounts and password verification.
- **Sessioning** owns opaque, expiring sessions for an external subject.
- **Posting** owns each post's author, text, and publication order.
- **Commenting** owns ordered attachments between an external target, author,
  and content identity, including author-controlled retraction.

Composition connects them. Registration and sign-in pass an authenticated
username to Sessioning. Protected endpoints resolve the session and use its
subject as Posting's or Commenting's external author. The `Board` composition
module owns the board former, which lists Posting's posts and nests Commenting
attachments whose target is each post.
Before adding a comment, the endpoint checks that its target post exists.

The authored application design lives under `design/`: concept specifications
state each independent concept's contract, composition specifications state how
the application connects them, and `design/types.md` records application types
and cross-concept bindings. Principle tests live under `tests/concepts/`. The
[technical notes](TECHNICAL.md) describe implementation choices, endpoint
branches, HTTP policy, cookie projection, runtime validation, execution limits,
failure boundaries, session cleanup, generated contracts, and network-test
evidence.

## Application and hosts

`createMessageBoard()` in `src/application.ts` builds the application and
standard gateway without choosing an HTTP deployment policy. Both hosts use that
constructor.

`src/edge.ts` defines the two policies. The plain policy exposes logical session
fields as JSON. The browser policy projects those fields into a secure,
`HttpOnly`, same-origin session cookie. The HTTP package converts each policy,
application, and gateway into a Fetch handler; Bun owns the listener and static
file routing.

This separation lets tests and other transports use the application without the
browser's cookie policy.

## Checks

```sh
bun run check
```

Use narrower commands when diagnosing a failure:

```sh
bun run test
bun run typecheck
bun run artifacts:check
```

Run `bun run artifacts:pin` only after an intentional specification,
composition, or contract change, then review both generated files.

## Source map

| Path                                                       | Role                                                            |
| ---------------------------------------------------------- | --------------------------------------------------------------- |
| `design/concepts/*.md`                                     | Standalone concept specifications                               |
| `design/compositions/*.md`                                 | Host-independent application composition design                 |
| `design/types.md`                                          | Application concrete types and cross-concept bindings           |
| `src/concepts/*.ts`, `src/concepts/*.registry.ts`          | Concept implementations and registrations                       |
| `src/concepts.ts`                                          | Application concept set and typed composition references        |
| `src/compositions/Sessions.ts`                             | Session endpoint groups and their authored specification        |
| `src/compositions/Board.ts`                                | Board endpoint groups, owned former, and authored specification |
| `src/compositions/validators.ts`                           | Runtime endpoint validator helpers                              |
| `src/assembly.ts`, `src/application.ts`                    | Assembly, execution limits, application, and gateway            |
| `src/edge.ts`                                              | Plain and cookie-backed HTTP policies                           |
| `src/api-host.ts`                                          | Bun host for the plain JSON API                                 |
| `src/client.ts`                                            | Typed cookie-projected HTTP client                              |
| `src/host.ts`, `src/web/`                                  | Bun browser host, static routing, and browser UI                |
| `tests/concepts/`, `tests/compositions/`                   | Concept principles and application/network behavior             |
| `tests/projected-wire-contract.ts`                         | Compile-time browser projection checks                          |
| [`generated/message-board.md`](generated/message-board.md) | Pinned assembled read-back                                      |
| [`generated/wire.ts`](generated/wire.ts)                   | Pinned logical and browser-projected contracts                  |

Continue with [Designing with concepts](../../docs/user/design.md) for concept
boundaries and composition criteria, or the [application
model](../../docs/user/overview.md) for assembly, endpoint, former, gateway, and
client roles.
