# Production HTTP

Production HTTP is a compact application showing one HTTP policy shape used with
and without cookie credentials. `Sessioning` issues random anonymous credentials
and owns their expiry; it does not accept a caller's identity claim. `Naming`
allocates non-identity namespace labels and contributes a `CONFLICT` category.
The transport owns JSON safety, public projection, correlation, and the cookie
binding. Runtime and toolchain requirements are declared in `package.json` and
the repository [support policy](../../SUPPORT.md).

## Run the example

Run these commands from this directory:

```sh
bun install
bun run check
bun run start
```

The scenario uses the generated projected HTTP client to issue and use a session,
claim a namespace label through the plain policy, observe the projected
duplicate-name conflict, and end the session.

## What the example establishes

- `httpPolicy(...)` projects policy-owned public categories with or without a
  cookie declaration.
- A cookie policy adds a same-origin `HttpOnly`, `SameSite=Strict` binding and
  removes its logical input/output fields from HTTP.
- Unauthorized protected requests and successful session ending clear the
  cookie; issuance and clearing responses carry `Cache-Control: no-store`.
- Sessioning stores each expiry, issues it thirty minutes from its injected
  clock with `crypto.randomUUID()` credentials, and removes expired credentials
  before refusing them as unauthorized.
- Every endpoint has runtime input and output validators; application and gateway
  execution limits bound admission, work expansion, and request duration.
- The explicit `/api` base path and correlation response header apply to both
  handlers.
- Production configuration rejects an HTTP public origin.
- The pinned module contains the logical wire and its projected HTTP form.
- `src/client.ts` binds callers to the projected form, which excludes the
  logical cookie fields removed by the HTTP policy.

The Fetch handlers adapt requests. The host or application supplies any required
CORS, TLS termination, HSTS, proxy policy, connection limits, rate limits, and
authentication.

## Source map

| Path                                                           | Role                                               |
| -------------------------------------------------------------- | -------------------------------------------------- |
| `src/concepts/*/`                                              | Specifications, implementations, and registrations |
| `src/composition.ts`                                           | Session and naming endpoints                       |
| `src/assembly.ts`                                              | Application assembly                               |
| `src/edge.ts`                                                  | Plain and cookie policies, gateway, and handlers   |
| `src/client.ts`                                                | Projected generated-contract HTTP client           |
| `src/scenario.ts`                                              | Runnable path through both HTTP policies           |
| `tests/application.test.ts`                                    | End-to-end HTTP and generated-wire contract        |
| `generated.config.ts`                                          | Logical and projected artifact configuration       |
| [`generated/production-http.md`](generated/production-http.md) | Pinned assembled read-back                         |
| [`generated/wire.ts`](generated/wire.ts)                       | Pinned logical and projected TypeScript contracts  |

Run `bun run artifacts:pin` only after an intentional application boundary
change, then review both generated files.
