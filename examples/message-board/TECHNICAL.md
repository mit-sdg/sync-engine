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

Posting retains posts permanently for the process lifetime and refuses empty,
whitespace-only, or over-500-character content. Commenting retains attachments
until `retract` succeeds, but the browser composition does not expose a retract
endpoint. Commenting itself does not validate its external target, author, or
content identities; the `/board/comment` endpoint applies the bounds needed by
this public boundary.

## Endpoint composition

The composition module declares a board former and seven endpoints. It declares
no reactions. Each endpoint stage is part of the request workflow rather than a
background consequence of a concept action.

| Endpoint         | Ordered workflow                                                                  |
| ---------------- | --------------------------------------------------------------------------------- |
| `/auth/register` | Receive credentials, ask `Authenticating.register`, return the username           |
| `/auth/sign-in`  | Authenticate, pass the username to `Sessioning.start` as its subject, respond     |
| `/auth/current`  | Resolve the session subject and return it as the current username                 |
| `/auth/sign-out` | Resolve and end the session                                                       |
| `/board/list`    | Resolve the session, then form the current board                                  |
| `/board/post`    | Resolve the session subject, adapt it to `Author`, publish the post               |
| `/board/comment` | Resolve the subject, check the target post, adapt the subject to `Author`, attach |

`/board/comment` uses two named branches. If `Posting._get` finds the target,
composition asks `Commenting.add`. If the query finds no target, composition
responds with the logical `POST_NOT_FOUND` error. Commenting remains independent:
its own `add` action can attach any external target identity.

The `board` former iterates over `Posting._all`. For each post row, it asks
`Commenting._for` with the post identity as the external target and nests the
matching attachments. The assembly's `maxRowsPerEvaluation` limit of 1,000
bounds this read. The other configured execution limits are recorded in
`src/assembly.ts`.

## HTTP session boundary

`src/edge.ts` constructs one `httpPolicy` and passes it to the Fetch handler.
The policy exposes the application below `/api`, maps reviewed concept refusals
to public HTTP categories, and binds the logical `session` input to the
`message-board-session` cookie.

Successful `/auth/sign-in` reads `session` and `expiresAt` from the logical
response, removes both fields from the HTTP response body, and issues the
cookie. Successful `/auth/sign-out` clears the cookie. An `UNAUTHORIZED` result
on an endpoint protected by this binding also clears the cookie. The cookie is
`HttpOnly`, `Secure`, `SameSite=Strict`, and `Path=/`; because it has no domain
and uses `/`, the handler derives the `__Host-` prefix.

The current-user, sign-out, board-list, post, and comment endpoints require the
logical `session` input. On those paths, the handler overwrites a body-supplied
session with the cookie value, or with `null` if no readable cookie is present.
The application then asks Sessioning whether that value identifies an active
session. Authentication and session interpretation remain application behavior;
the HTTP package only performs the declared cookie binding.

The endpoints do not accept an author field. Composition derives the author from
the active session subject. Every endpoint also has explicit input and output
validators. These validators reject extra fields and bound public strings;
generated TypeScript alone does not validate requests received at runtime.

The host serves the UI and API from one origin. It uses Bun's listener and
bundler directly and does not add a web framework. The HTTP package itself owns
neither the listener nor process lifecycle; see the [HTTP package
README](https://github.com/mit-sdg/sync-engine/blob/main/packages/http/README.md) for host responsibilities and the
complete policy contract.

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

The HTTP projection removes cookie-owned session inputs from browser calls. It
also removes the issued session and expiry fields from sign-in's browser-visible
output. The browser client in `src/client.ts` is typed by that projected wire.

Do not edit generated files directly. After an intentional specification,
composition, or policy change, regenerate and review both files:

```sh
bun run artifacts:pin
```

Use `bun run artifacts:check` to verify that checked-in artifacts still match
their sources.

## Verification

Concept tests under `src/concepts/*/` exercise each concept directly. The
application test starts the real host and verifies:

- browser HTML and bundled JavaScript are served;
- unauthenticated board access is rejected and clears an applicable cookie;
- registration, sign-in, current-user lookup, posting, commenting, listing, and
  sign-out complete over the network through the projected client;
- the issued cookie has the derived `__Host-` name;
- a body-supplied session cannot replace the cookie session;
- a body-supplied author is rejected; and
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
