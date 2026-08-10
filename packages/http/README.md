# @mit-sdg/sync-engine-http

`@mit-sdg/sync-engine-http` adapts an assembled sync-engine application to Fetch
`Request` and `Response` objects and provides a typed Fetch client. The package
does not create a listener, terminate TLS, configure CORS, or own server
lifecycle.

The handler and generated HTTP contract use one `HttpPolicy`. A plain policy
defines the public origin, optional base path, and public errors. Adding
`HttpPolicy.cookie` binds one required logical input to an `HttpOnly` cookie and
projects the consumed credential fields out of HTTP.

## Install

The HTTP package requires the exact matching core beta. Pin and upgrade both
packages together:

```sh
bun add --exact @mit-sdg/sync-engine@1.0.0-beta.8 @mit-sdg/sync-engine-http@1.0.0-beta.8
```

The package is ESM-only and supports Node.js `>=24 <25`. It has no root export.

| Public subpath                      | Exports                                                                  |
| ----------------------------------- | ------------------------------------------------------------------------ |
| `@mit-sdg/sync-engine-http/server`  | `httpPolicy`, policy types, `createHttpHandler`, and correlation options |
| `@mit-sdg/sync-engine-http/client`  | Typed Fetch client and lower-level transport                             |
| `@mit-sdg/sync-engine-http/tooling` | `httpWire` generated-contract projection                                 |

Deep imports are unsupported.

## Plain JSON policy

This example assumes `assembleApplication()` returns an assembly with a
`/names/claim` endpoint and the `NAME_TAKEN` domain refusal.

```ts
// src/http-edge.ts
import { createGateway } from "@mit-sdg/sync-engine/boundary";
import { createHttpHandler, httpPolicy } from "@mit-sdg/sync-engine-http/server";
import { assembleApplication } from "./assembly.ts";

export const applicationHttpPolicy = httpPolicy({
  origin: "https://api.example.com",
  basePath: "/api",
  publicErrors: { NAME_TAKEN: "CONFLICT" },
});

export function buildHttpEdge() {
  const application = assembleApplication();
  const gateway = createGateway({ application });
  const handler = createHttpHandler({
    application,
    gateway,
    policy: applicationHttpPolicy,
  });

  return { application, gateway, handler };
}
```

The handler exposes the logical `/names/claim` path at
`POST /api/names/claim`. It accepts a missing `Content-Type`; when present, the
value must be `application/json` with optional parameters. The request body must
be valid JSON and cannot exceed 1,048,576 bytes.

`publicErrors` is an allowlist. In this example, `NAME_TAKEN` becomes
`{"error":"CONFLICT"}` with status 409. Unmapped domain failures become the
opaque `{"error":"INTERNAL_ERROR"}` with status 500.

A plain policy does not inspect the inbound `Origin` header. The required
`origin` describes the public deployment origin and must use HTTPS when
`NODE_ENV=production`; it does not configure CORS.

### Generate the matching HTTP contract

Pass the same policy value to `httpWire`:

```ts
// generated.config.ts
import { httpWire } from "@mit-sdg/sync-engine-http/tooling";
import { assembleApplication } from "./src/assembly.ts";
import { applicationHttpPolicy } from "./src/http-edge.ts";

export default {
  assemble: assembleApplication,
  title: "Application",
  wireName: "ApplicationWire",
  projections: [httpWire({ policy: applicationHttpPolicy, name: "ApplicationWireHttp" })],
};
```

```sh
bunx sync-engine artifacts pin --config generated.config.ts
```

The projection maps known domain refusals to the same public categories as the
handler. Unknown and open domain failures project as `INTERNAL_ERROR`.

### Call the generated contract

```ts
import { createHttpClient } from "@mit-sdg/sync-engine-http/client";
import type { ApplicationWireHttp } from "./generated/wire.ts";

const client = createHttpClient<ApplicationWireHttp>({ baseUrl: "/api" });
const result = await client.names.claim({ name: "atlas" });
```

The client sends JSON `POST` requests and uses `credentials: "include"` by
default. An omitted `baseUrl` uses `API_BASE_URL`, then `/api`; an explicit `/`
selects the current origin root. Endpoint calls resolve handled server and
transport failures as error envelopes. See the [client
reference](public-surface.md#client) for abort, timeout, headers, response
validation, and response-size behavior.

## Cookie policy

Add `cookie` when one required endpoint input must come from a browser cookie.
The application still owns credential creation, expiry, revocation, and domain
authorization.

This policy supports initial issuance and session rotation through different
routes and output fields:

```ts
import { createGateway } from "@mit-sdg/sync-engine/boundary";
import {
  createHttpHandler,
  httpPolicy,
  type HttpCookieIssue,
  type HttpCookiePolicy,
  type HttpPolicy,
} from "@mit-sdg/sync-engine-http/server";
import { assembleApplication } from "./assembly.ts";

const issues: readonly HttpCookieIssue[] = [
  { path: "/sessions/start", value: "session", expires: "expiresAt" },
  {
    path: "/sessions/rotate",
    value: "replacement",
    expires: "replacementExpiresAt",
  },
];

const cookie: HttpCookiePolicy = {
  name: "session",
  input: "session",
  issue: issues,
  clear: ["/sessions/end", "/sessions/end-all"],
};

export const sessionHttpPolicy: HttpPolicy = httpPolicy({
  origin: "https://api.example.com",
  basePath: "/api",
  publicErrors: { UNKNOWN_SESSION: "UNAUTHORIZED" },
  cookie,
});

const application = assembleApplication();
const gateway = createGateway({ application });
export const handler = createHttpHandler({
  application,
  gateway,
  policy: sessionHttpPolicy,
});
```

An endpoint is protected when its input contract lists `cookie.input` as
required. For a protected route, the handler overwrites any body-supplied
`session` with the decoded cookie value or `null`. The generated HTTP contract
omits that input.

After a successful issue route, the handler requires a nonempty string in the
configured value field and a future expiry. It removes the value and expiry
fields from the JSON response and sets the cookie. Each issue route can name
different output fields. A successful clear route clears the cookie. An
`UNAUTHORIZED` result from any protected route also clears it.

### Secure defaults

For an HTTPS policy origin, the default cookie is:

- prefixed `__Host-` when `Path=/` and no `Domain` is configured;
- marked `Secure` and `HttpOnly`;
- `SameSite=Strict`;
- scoped to `Path=/` with no `Domain`;
- sent with an absolute `Expires` value supplied by the issuing endpoint.

Issue, successful clear, and unauthorized protected responses that clear the
cookie use `Cache-Control: no-store`. The serialized issuing cookie must not
exceed 4,096 characters.

### Origin enforcement

A cookie policy defaults `origins` to the policy origin. Every request handled
by that cookie-policy handler must include a present `Origin` header that exactly
matches an allowed origin. A missing or mismatched value returns
`FORBIDDEN`/403 before method and body processing.

Use an explicit nonempty allowlist when a browser frontend has another origin:

```ts
const policy = httpPolicy({
  origin: "https://api.example.com",
  cookie: {
    name: "session",
    input: "session",
    issue: issues,
    origins: ["https://app.example.com"],
  },
});
```

This allowlist does not implement CORS. The handler does not answer `OPTIONS`
preflight requests or emit `Access-Control-Allow-*` headers. The host must
configure CORS consistently with the policy.

The lower-level `origins: false` setting disables the Origin check. Use it only
when another trusted layer enforces an equivalent request-origin or
cross-site-request policy. Disabling this check removes the package's default
cookie request-origin defense.

### Cookie customization

`sameSite`, `path`, and `domain` are configurable. `SameSite=None` requires an
HTTPS policy origin. A configured domain must be a canonical parent DNS hostname
of the policy origin. A domain or non-root path uses the `__Secure-` prefix under
HTTPS instead of `__Host-`.

Logical cookie names cannot include the reserved `__Host-` or `__Secure-`
prefix. The handler chooses the prefix after validating the complete policy.
Issue and clear paths must be distinct portable endpoint paths and cannot
overlap. `createHttpHandler` also verifies that all paths exist, at least one
endpoint requires the protected input, and every issue output contains its
declared value and expiry fields.

Pass `sessionHttpPolicy` to `httpWire` as well. The projected contract removes
the protected input from every protected route and removes each issue route's
own value and expiry fields.

## Responses, correlation, and limits

Successful invocations return status 200 and JSON. Public failures use these
categories and statuses:

| Category          | Status |
| ----------------- | ------ |
| `INVALID_REQUEST` | 400    |
| `UNAUTHORIZED`    | 401    |
| `FORBIDDEN`       | 403    |
| `NOT_FOUND`       | 404    |
| `CONFLICT`        | 409    |
| `INTERNAL_ERROR`  | 500    |

Public failure bodies contain only `{ error }`. Exception text and private
domain values do not cross the handler boundary.

Optional correlation configuration resolves one ID per request and can place it
in a response header. The effective ID also reaches gateway and application
observers. Missing, invalid, or faulting resolver output is replaced with a
UUID. Correlation is tracing information, not an idempotency key.

Handler calls can overlap. Request abort stops invocation waiting but does not
roll back or cancel accepted concept work. The handler has no disposal method
and does not own the application, gateway, concept stores, listener, or Fetch
runtime.

## Host and application responsibilities

The host owns the listener, TLS termination, HSTS, CORS and preflight handling,
trusted-proxy policy, connection and request-rate limits, denial-of-service
controls, retries, process admission, startup, drain, shutdown, and forced-exit
deadline. Browser cookie storage belongs to the browser. Node.js and custom
Fetch clients must supply a cookie store when later requests depend on an issued
cookie.

The application owns credential meaning, durable storage, session recovery,
resource authorization, idempotency, and transactions. The HTTP package does
not turn a credential cookie into a complete authentication or authorization
system.

See the exact [HTTP public API](public-surface.md), the self-contained
[Production HTTP example](../../examples/production-http/README.md), [boundary
and client semantics](../../docs/user/reference/semantics.md#boundary-gateway-and-client),
and [HTTP host responsibilities](../../docs/user/reference/operations.md#http-host-responsibilities).
