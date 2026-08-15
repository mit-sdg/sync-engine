# Message board technical notes

This page records implementation, boundary, failure, and verification details
for the [message-board example](README.md). It describes the example as shipped;
the public contracts for sync-engine and its HTTP package remain authoritative.

## Concept ownership and implementation

| Concept          | Owned facts and behavior                                                   | External identities               |
| ---------------- | -------------------------------------------------------------------------- | --------------------------------- |
| `Authenticating` | Accounts, salted password verifiers, registration, and credential checking | None                              |
| `Sessioning`     | Opaque session values, subjects, expiry times, lookup, and termination     | `Subject`                         |
| `Posting`        | Post identities, string content, author association, and publication order | `Author`                          |
| `Commenting`     | Ordered attachments and author-controlled retraction                       | `Target`, `Author`, and `Content` |

No concept imports or names another concept. Posting owns its string content.
Commenting owns only an attachment between three external identities. The web UI
uses the entered comment string as a `Content` identity and renders that runtime
value verbatim. This application-level adaptation does not make Commenting the
owner or validator of comment text.

The implementations are process-local teaching stores. Authenticating currently
uses PBKDF2-SHA256 with a per-account salt, 10,000 iterations, and a 32-byte
verifier, then compares verifiers with `timingSafeEqual`. Sessioning currently
uses random UUID session values and a 30-minute lifetime. Accounts, sessions,
posts, and comments are held in memory and are not recovered after restart.
These implementation choices are not general sync-engine guarantees.

Posting retains posts for the process lifetime and refuses blank content or
content longer than 500 characters. It declares no retraction, so a published
post cannot be removed. Commenting retains an attachment until its author
retracts it, and `/board/retract-comment` exposes that transition. Commenting
does not validate its external target, author, or content identities. The
`/board/comment` endpoint applies the public boundary's length constraints; those
constraints do not apply to direct calls through `Assembly.concepts`.

## Endpoint composition

The application divides endpoint declarations between
`src/compositions/Sessions.ts` and `src/compositions/Board.ts`. The `Board`
composition module also owns the board former. Each module exports one
`composition` aggregate installed by `src/assembly.ts`.
`src/compositions/validators.ts` contains shared runtime validator helpers but
no design or composition declarations. The matching registered design documents
cite the installed declarations with typed links; executable modules do not
import those documents.

| Endpoint                 | Ordered workflow                                                                  |
| ------------------------ | --------------------------------------------------------------------------------- |
| `/auth/register`         | Register credentials, start a session for the username, respond                   |
| `/auth/sign-in`          | Authenticate, pass the username to `Sessioning.start` as its subject, respond     |
| `/auth/current`          | Resolve the session subject and return it as the current username                 |
| `/auth/sign-out`         | Resolve and end the session                                                       |
| `/board/list`            | Resolve the session, then form the current board                                  |
| `/board/post`            | Resolve the session subject, adapt it to `Author`, publish the post               |
| `/board/comment`         | Resolve the subject, check the target post, adapt the subject to `Author`, attach |
| `/board/retract-comment` | Resolve the subject and ask `Commenting.retract` with it as the claimed author    |

`/board/comment` uses two named branches. If `Posting._get` finds the target,
composition asks `Commenting.add`. If the query finds no target, composition
responds with the logical `POST_NOT_FOUND` error. Commenting remains independent:
its own `add` action can attach any external target identity.

`/board/retract-comment` passes the session subject to `Commenting.retract` as
the claimed author. Commenting returns `COMMENT_AUTHOR_MISMATCH` for another
author's comment and `COMMENT_NOT_FOUND` for an unknown comment. The HTTP policy
maps those refusals to `FORBIDDEN` and `NOT_FOUND`, respectively. Commenting also
enforces the rule on direct concept calls. The browser's decision to omit the
button for another author's comment is presentation, not enforcement.

The `Board` former iterates over `Posting._all`. For each post row, it asks
`Commenting._for` with the post identity as the external target and nests the
matching attachments. The assembly sets `maxRowsPerEvaluation` to 1,000. If
former expansion exceeds that limit, evaluation fails instead of returning a
truncated board. The other execution limits are recorded in `src/assembly.ts`.

## Session expiry

Sessioning owns expiry and cleanup; neither is a scheduled application workflow.
At its expiry, a session becomes logically inactive. The expired record may
remain in the in-memory map until a Sessioning action removes it.

Cleanup is opportunistic. `start` removes all expired records before allocating
a new session. `current` and `end` remove the expired record they encounter and
then refuse the action with `UNKNOWN_SESSION`. `_active` returns no row for an
expired session without mutating state.

Assembly performs no cleanup initialization, and the host schedules no cleanup.
There is no periodic reclamation guarantee. A durable Sessioning implementation
may use another storage and reclamation mechanism, but it must preserve the
specified action and query behavior.

## Application, boundary, and host layers

`createMessageBoard()` in `src/application.ts` assembles the concepts and creates
a gateway with the execution limits from `src/assembly.ts`. It returns the
application and gateway. Tests, non-HTTP callers, and both example hosts use
this policy-independent constructor.

`src/edge.ts` supplies two policies. `messageBoardApiPolicy()` selects `/api` and
maps reviewed concept refusals to public HTTP categories. It declares no
cookies, browser origins, or request-origin checks. `messageBoardHttpPolicy(...)`
adds the cookie binding used by the browser deployment. Policy construction is
separate from handler binding: each host calls `createMessageBoard()`, selects a
policy, and passes the application, gateway, and policy to
`createHttpHandler(...)`.

The returned Fetch handler maps a complete `Request` to a
`Promise<Response>`. It does not open a listener. `src/api-host.ts` gives the
plain handler directly to `Bun.serve`. `src/host.ts` wraps the cookie-backed
handler with GET routes for `index.html` and the bundled browser client, then
passes that routing function to `Bun.serve`. Bun owns the listener and process
lifecycle; the browser host owns bundling and static-file routing.

Both hosts require a nonempty `HOST` and an integer `PORT` from 1 through 65535.
The browser host also validates `PUBLIC_ORIGIN` as an absolute HTTP or HTTPS
origin without credentials, path, query, or fragment. Invalid values terminate
startup before `Bun.serve` runs.

### Plain POST/JSON binding

The plain API exchanges every logical input and output as JSON. Registration and
sign-in responses contain `session` and `expiresAt`. Current-user, sign-out,
board-list, post, and comment requests must include that session in the body.
The handler emits no `Set-Cookie` or CORS headers. The API host serves no
frontend assets.

This binding is suitable for callers that retain and send session values
explicitly. `MessageBoardWireHttp` describes the browser binding and removes
cookie-owned fields.

### Browser cookie binding

The browser policy binds the logical `session` input to the
`message-board-session` cookie. Successful registration and sign-in read
`session` and `expiresAt` from the logical response, remove both fields from the
HTTP response body, and issue the cookie. Successful `/auth/sign-out` clears the
cookie. An `UNAUTHORIZED` result on an endpoint protected by this binding also
clears the cookie. The cookie is `HttpOnly`, `Secure`, `SameSite=Strict`, and
`Path=/`; because it has no domain and uses `/`, the handler derives the
`__Host-` prefix.

The current-user, sign-out, board-list, post, comment, and comment-retraction
endpoints require the logical `session` input. On those paths, the handler
overwrites a body-supplied session with the cookie value, or with `null` if no
readable cookie is present.
The application then asks Sessioning whether that value identifies an active
session. Authentication and session interpretation remain application behavior;
the HTTP package performs only the declared cookie binding.

The browser host serves the UI and API from one origin and declares no CORS
policy. `PUBLIC_ORIGIN` identifies that externally visible origin; the cookie
policy derives its request-origin allowlist from the same value. Bun configures
the listener and serves the frontend. A separate-origin browser deployment
requires an explicit `browser` policy with matching CORS, credentials, and
request-origin settings.

The endpoints do not accept an author field. Composition derives the author from
the active session subject. Every endpoint also has explicit input and output
validators. These validators reject extra fields and bound public strings;
generated TypeScript alone does not validate requests received at runtime.

See the [HTTP package
README](https://github.com/mit-sdg/sync-engine/blob/main/packages/http/README.md)
for the complete policy and host-responsibility contract.

## Failure and commit boundaries

Malformed endpoint input fails admission before a concept action runs. Expected
concept refusals pass through the endpoint and are mapped by the HTTP policy;
private or unmapped failures are exposed as `INTERNAL_ERROR`. Unknown, ended,
or expired sessions become `UNAUTHORIZED` at this boundary.

Each accepted concept action changes only that concept's state and commits
independently. The runtime serializes action bodies per concept instance. The
application does not provide a transaction across Authenticating, Sessioning,
Posting, and Commenting, and it does not automatically retry failed work.

Repeated sign-in creates another session. Repeated post publication creates
another post, and repeated comment attachment creates another comment. If the
process stops after a post is published but before a later comment is attached,
the two actions are not rolled back together. Because this example uses only
in-memory stores, process termination discards all stored application state and
does not recover accepted work.

## Generated contracts

`generated.config.ts` generates two views of the boundary:

- [`generated/message-board.md`](generated/message-board.md) is the assembled
  read-back of registered concepts and composition.
- [`generated/wire.ts`](generated/wire.ts) contains the logical
  `MessageBoardWire` and the HTTP-projected `MessageBoardWireHttp`.

The HTTP projection uses `messageBoardPolicy`, the browser host's cookie policy.
It removes cookie-owned session inputs from browser calls and removes the issued
session and expiry fields from registration and sign-in outputs. The browser
client in `src/client.ts` is typed by that projected wire. The plain API instead
exposes the logical fields shown by `MessageBoardWire`; it does not use the
cookie-projected client contract.

Do not edit generated files directly. After an intentional specification,
composition, or policy change, regenerate and review both files:

```sh
bun run artifacts:pin
```

Use `bun run artifacts:check` to verify that checked-in artifacts still match
their sources.

## Verification

Concept tests under `tests/concepts/` exercise each concept directly. The
application and network test under `tests/compositions/` starts both real hosts
and verifies:

- the plain host accepts registration as JSON, returns session fields, emits no
  cookie, and serves no frontend root;
- browser HTML and bundled JavaScript are served;
- unauthenticated board access is rejected and clears an applicable cookie;
- registration, sign-in, current-user lookup, posting, commenting, retracting,
  listing, and sign-out complete over the network through the projected client;
- the issued cookie has the derived `__Host-` name;
- a body-supplied session cannot replace the cookie session;
- a body-supplied author is rejected;
- retracting someone else's comment answers `FORBIDDEN`, and retracting a
  retracted comment answers `NOT_FOUND`;
- invalid listener and public-origin configuration fails before startup; and
- every endpoint has input and output validators and the projected wire omits
  cookie-owned fields.

`tests/projected-wire-contract.ts` adds compile-time checks that projected client
calls cannot provide session or author fields.

Run the complete example verification from this directory:

```sh
bun run check
```

Use the narrower scripts when diagnosing a failure:

```sh
bun run test
bun run typecheck
bun run artifacts:check
```
