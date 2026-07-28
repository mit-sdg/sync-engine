# Production HTTP

Production HTTP is a complete application showing the production public-error
profile separately from same-origin cookie credentials. `Sessioning` owns
credential meaning and expiry; `Naming` contributes a non-authentication
`CONFLICT` category. The transport owns JSON safety, public projection,
correlation, and the cookie binding. It requires Bun 1.3 or newer.

## Run the example

Run these commands from this directory:

```sh
bun install
bun run check
bun run start
```

The scenario issues a session, uses it on a protected endpoint, claims a name
through the credential-free production profile, observes the projected
duplicate-name conflict, and ends the session.

## What the example establishes

- `productionHttpProfile(...)` projects registered public categories without
  requiring a credential mechanism.
- `httpFloor(...)` adds one same-origin `HttpOnly`, `SameSite=Strict` cookie
  binding and removes its logical input/output fields from HTTP.
- Unauthorized protected requests and successful session ending clear the
  cookie; issuance and clearing responses are not stored.
- Sessioning stores each expiry, issues it thirty minutes from its injected
  clock, and removes expired credentials before refusing them as unauthorized.
- The explicit `/api` base path and correlation response header apply to both
  production handler forms.
- Production configuration rejects an HTTP public origin.
- The pinned module contains the logical wire and its projected HTTP form.

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
| `src/scenario.ts`                                              | Runnable path through both production HTTP forms        |
| `tests/application.test.ts`                                    | End-to-end HTTP and generated-wire contract             |
| `generated.config.ts`                                          | Logical and projected artifact configuration            |
| [`generated/production-http.md`](generated/production-http.md) | Pinned assembled read-back                              |
| [`generated/wire.ts`](generated/wire.ts)                       | Pinned logical and projected TypeScript contracts       |

Run `bun run artifacts:pin` only after an intentional application boundary
change, then review both generated files.
