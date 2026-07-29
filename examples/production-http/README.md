# Production HTTP

Production HTTP is a compact application showing the production public-error
profile separately from same-origin cookie credentials. `Sessioning` issues
random anonymous credentials and owns their expiry; it does not accept a caller's
identity claim. `Naming` allocates non-identity namespace labels and contributes
a `CONFLICT` category. The transport owns JSON safety, public projection,
correlation, and the cookie binding. Runtime and toolchain requirements are
declared in `package.json` and the repository [support policy](../../SUPPORT.md).

## Run the example

Run these commands from this directory:

```sh
bun install
bun run check
bun run start
```

The scenario uses the generated projected HTTP client to issue and use a session,
claim a namespace label through the credential-free production profile, observe
the projected duplicate-name conflict, and end the session.

## What the example establishes

- `productionHttpProfile(...)` projects registered public categories without
  requiring a credential mechanism.
- `httpFloor(...)` adds one same-origin `HttpOnly`, `SameSite=Strict` cookie
  binding and removes its logical input/output fields from HTTP.
- Unauthorized protected requests and successful session ending clear the
  cookie; issuance and clearing responses are not stored.
- Sessioning stores each expiry, issues it thirty minutes from its injected
  clock with `crypto.randomUUID()` credentials, and removes expired credentials
  before refusing them as unauthorized.
- Every endpoint has runtime input and output validators; application and gateway
  execution limits bound admission, work expansion, and request duration.
- The explicit `/api` base path and correlation response header apply to both
  production handler forms.
- Production configuration rejects an HTTP public origin.
- The pinned module contains the logical wire and its projected HTTP form.
- `src/client.ts` binds callers to that projected form rather than the logical
  cookie fields removed by the HTTP floor.

The Fetch handlers are not complete servers. CORS, TLS termination, HSTS,
trusted proxies, reverse-proxy policy, connection and rate limits, and the
application's authentication design remain host or application concerns.

## Source map

| Path                                                           | Role                                                    |
| -------------------------------------------------------------- | ------------------------------------------------------- |
| `src/concepts/*/`                                              | Specifications, implementations, and registrations      |
| `src/composition.ts`                                           | Session and naming endpoints                            |
| `src/assembly.ts`                                              | Application assembly                                    |
| `src/edge.ts`                                                  | Production profile, cookie floor, gateway, and handlers |
| `src/client.ts`                                                | Projected generated-contract HTTP client                |
| `src/scenario.ts`                                              | Runnable path through both production HTTP forms        |
| `tests/application.test.ts`                                    | End-to-end HTTP and generated-wire contract             |
| `generated.config.ts`                                          | Logical and projected artifact configuration            |
| [`generated/production-http.md`](generated/production-http.md) | Pinned assembled read-back                              |
| [`generated/wire.ts`](generated/wire.ts)                       | Pinned logical and projected TypeScript contracts       |

Run `bun run artifacts:pin` only after an intentional application boundary
change, then review both generated files.
