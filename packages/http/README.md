# @mit-sdg/sync-engine-http

`@mit-sdg/sync-engine-http` exposes an assembled application over POST/JSON
through a Fetch handler, typed client, and generated wire projection. The host
opens and owns the listener. HTTP policy adds cookies, request-origin protection,
a route prefix, body limits, or public error mappings; browser policy adds CORS.

## Install

The HTTP package is published separately and declares an exact peer dependency
on the matching core beta. Pin both packages to the same exact version and
upgrade them together:

```sh
bun add --exact @mit-sdg/sync-engine@1.0.0-beta.15 @mit-sdg/sync-engine-http@1.0.0-beta.15
```

The current beta is ESM-only and supports Node.js 24 (`>=24 <25`). The package
has no root export and no supported deep imports.

| Public subpath                      | Purpose                                      |
| ----------------------------------- | -------------------------------------------- |
| `@mit-sdg/sync-engine-http/policy`  | Immutable deployment policy and policy types |
| `@mit-sdg/sync-engine-http/handler` | Fetch handler and handler options            |
| `@mit-sdg/sync-engine-http/client`  | Typed Fetch client and lower-level transport |
| `@mit-sdg/sync-engine-http/tooling` | Generated HTTP wire projection               |

## Tier 0: plain POST/JSON

A plain handler needs no HTTP policy:

```ts
import { createGateway } from "@mit-sdg/sync-engine/boundary";
import { createHttpHandler } from "@mit-sdg/sync-engine-http/handler";
import { assembleApplication } from "./assembly.ts";

const application = assembleApplication();
const gateway = createGateway({ application });

export const handler = createHttpHandler({ application, gateway });
```

The handler accepts `POST` requests with JSON bodies, and the `GET` routes a
policy declares under [direct routes](#direct-routes). Endpoint paths are exposed
at the origin root, request bodies are limited to 1,048,576 bytes, and private
failures become `{ "error": "INTERNAL_ERROR" }`. The handler emits no CORS or
cookie headers without a policy. It does not validate primitive or nested input
shapes beyond the application's endpoint validators.

The host must route the complete request URL to `handler(request)`; the handler
selects an endpoint from its pathname. For example:

```ts
const listener = Bun.serve({ hostname: "127.0.0.1", port: 3000, fetch: handler });
```

`Bun.serve` opens the listener, but Bun is outside the package's Node.js 24
support contract. A Node.js 24 host or adapter can supply the same Fetch
`Request` and consume its `Response`; the package provides no host executable.

### Public errors, base path, and generated contract

Use `httpPolicy(...)` when the deployment needs a route prefix, public domain
errors, or a different request-body limit:

```ts
import { httpPolicy } from "@mit-sdg/sync-engine-http/policy";

export const policy = httpPolicy({
  basePath: "/api",
  publicErrors: { NAME_TAKEN: "CONFLICT" },
  limits: { requestBodyBytes: 2_000_000 },
});

export const handler = createHttpHandler({ application, gateway, policy });
```

`httpPolicy` validates, copies, freezes, and brands deployment facts; consumers
reject raw objects. The package derives transport controls from declared public
and browser origins and cookie-to-endpoint bindings.

Use the same policy to project the browser-visible wire:

```ts
// generated.config.ts
import { httpWire } from "@mit-sdg/sync-engine-http/tooling";
import { assembleApplication } from "./src/assembly.ts";
import { policy } from "./src/http-edge.ts";

export default {
  assemble: assembleApplication,
  title: "Application",
  wireName: "ApplicationWire",
  projections: [httpWire({ policy, name: "ApplicationWireHttp" })],
};
```

`httpWire` maps domain refusals through `publicErrors`; unmapped refusals become
`INTERNAL_ERROR`. Cookie policies also remove transport-owned credential inputs
and issued cookie fields from the projected contract.

Create a typed client from that projected type:

```ts
import { createHttpClient } from "@mit-sdg/sync-engine-http/client";
import type { ApplicationWireHttp } from "./generated/wire.ts";

const client = createHttpClient<ApplicationWireHttp>({ baseUrl: "/api" });
const result = await client.names.claim({ name: "atlas" });
```

The client always sends JSON `POST` requests. It takes no policy and defaults to
`credentials: "same-origin"`. If `baseUrl` is omitted, the client uses
`API_BASE_URL`, then `/api`; an explicit `/` selects the origin root.

See the [HTTP public API reference](public-surface.md) for exact validation,
result, timeout, abort, and response-size behavior.

## Tier 1: browser sessions

This policy binds credentials to cookies for an API at
`https://api.example.com` and a credentialed frontend at
`https://app.example.com`:

```ts
import { httpPolicy } from "@mit-sdg/sync-engine-http/policy";

export const policy = httpPolicy({
  publicOrigin: "https://api.example.com",
  basePath: "/api",
  publicErrors: { UNKNOWN_SESSION: "UNAUTHORIZED" },
  browser: {
    origins: ["https://app.example.com"],
    credentials: true,
  },
  cookies: {
    session: {
      name: "session",
      input: "session",
      issue: [
        { path: "/sessions/start", value: "session", expires: "expiresAt" },
        { path: "/sessions/rotate", value: "session", expires: "expiresAt" },
      ],
      clear: ["/sessions/end"],
    },
  },
});
```

Pass `policy` to both `createHttpHandler(...)` and `httpWire(...)`. A
cross-origin browser client must opt into credentials:

```ts
const client = createHttpClient<ApplicationWireHttp>({
  baseUrl: "https://api.example.com/api",
  credentials: "include",
});
```

### Cookie binding

A cookie binding names a logical input, one or more successful issue endpoints,
and zero or more successful clear endpoints. Every protected endpoint must list
the bound input as required. On those endpoints, the handler overwrites any body
value with the cookie value, or with `null` when the cookie is absent or
unreadable. The application still decides what the credential means and whether
the caller is authorized.

On an issue response, the handler reads the declared value and future expiry,
removes both fields from the JSON response, sets the cookie, and adds
`Cache-Control: no-store`. Clear responses also use `no-store`. An
`UNAUTHORIZED` result clears only the binding that protects that path;
`FORBIDDEN` does not clear a cookie.

Cookies are always `HttpOnly` and `Secure`. The package derives a `__Host-`
prefix when the cookie has no domain and uses `Path=/`; otherwise it derives
`__Secure-`. Cookie `SameSite` does not come from a comparison of frontend and
API sites:

| Declared browser policy                          | Derived `SameSite` |
| ------------------------------------------------ | ------------------ |
| No browser policy                                | `Strict`           |
| `browser.credentials: true`                      | `None`             |
| Browser policy without credentials, with cookies | Rejected           |

Cookie policy requires `publicOrigin` to use HTTPS or a loopback host. Loopback
means `localhost`, `127.0.0.1`, or `[::1]`. Advanced cookie bindings may
override only `sameSite`, `path`, and `domain`; `HttpOnly` and `Secure` cannot be
disabled.

`httpPolicy` validates deployment-only facts. Checks that need endpoint
contracts run later: `createHttpHandler` validates the policy when it binds the
application, and `httpWire(...).project` performs the same validation during
projection. These checks reject unknown issue or clear paths, missing issue
outputs, optional use of a credential input, and overlapping protection by two
cookies.

### CORS and request-origin protection

CORS controls whether a browser exposes a response to frontend code. The
`browser` policy uses exact origin matching, answers valid `OPTIONS` preflights,
emits allow-origin and configured header metadata, and adds the required `Vary`
fields. CORS headers are applied to successful and error responses for an
allowed origin.

Request-origin protection separately controls which origins may invoke
protected, issuing, and clearing endpoints. By default, the allowlist is
`publicOrigin` plus `browser.origins`. A present disallowed `Origin` returns
`FORBIDDEN`/403. A missing `Origin` is allowed by default so non-browser callers can attach
credentials deliberately. Set
`requestOrigins.requireOrigin: true` only when every caller is expected to send
`Origin`.

CORS does not authorize requests. Request-origin protection does not make a
response readable across origins. Disabling request-origin protection is
rejected when any cookie uses `SameSite=None`, because that combination removes
both origin and SameSite request defenses.

The [message-board example](https://github.com/mit-sdg/sync-engine/blob/main/examples/message-board/README.md)
shows a checked browser application lifecycle.

## Tier 2: headers, wrapping, and custom transports

### Response headers and correlation

`responseHeaders` adds static or per-response headers. The callback receives the
request, resolved path, status, and optional correlation id. The handler drops
`Set-Cookie`, `Cache-Control`, every `Access-Control-*` header, and `Vary` from
this option; policy-owned headers remain authoritative. A throw or rejected
promise produces an opaque `INTERNAL_ERROR`/500 response.

```ts
const handler = createHttpHandler({
  application,
  gateway,
  policy,
  responseHeaders: ({ status }) => ({
    "X-Service-Version": version,
    "X-Response-Class": status < 500 ? "handled" : "failed",
  }),
  correlation: {
    resolve: (request) => request.headers.get("X-Request-Id") ?? undefined,
    responseHeader: "X-Request-Id",
  },
});
```

There are no request-preprocessing or response-decorating hooks. Wrap the Fetch
handler when middleware must transform requests or responses:

```ts
const inner = createHttpHandler({ application, gateway, policy });

export async function handler(request: Request): Promise<Response> {
  const response = await inner(request);
  audit(request, response);
  return response;
}
```

A wrapper is outside the package's security boundary. It can remove CORS,
cookie, cache, or error protections; the deployment owns the resulting behavior.

### Direct routes

A client that cannot post — a browser following a link — reaches an endpoint through a
policy `direct` route. The endpoint is unchanged; the route says how its value is served.

```ts
const policy = httpPolicy({
  direct: [{ method: "GET", path: "/{code}", endpoint: "/resolve", redirect: "target" }],
});
```

Each `{name}` segment fills the endpoint input of that name, percent-decoded; an empty
segment does not match. `redirect` names a response field holding an absolute URL and
answers `302`; `status` alone answers that status with the JSON body; a route states one of
them. `GET` only, parameter names may not repeat, and two routes may not share a method and
shape. The endpoint keeps its `POST` path. A direct route carries no cookies and skips the
request-origin check, so it cannot serve an endpoint that issues or clears one.

### Custom transport

Use a custom transport when the deployment needs methods other than `POST` or a declared
direct route,
different serialization, streaming, framework-owned routing, preprocessing, or
response transformation that the HTTP package does not support. The supported
core building blocks are:

| Core subpath                    | Public exports used by transport implementations                                                                                                                  |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@mit-sdg/sync-engine/assembly` | `Assembly`                                                                                                                                                        |
| `@mit-sdg/sync-engine/boundary` | `bindTransport`, `Gateway`, `InvocationResult`, `FrameworkErrorCode`, `serializeJsonValue`, `assertPortableRoutePath`, `InputContractDecl`, `WireProjectionFacts` |
| `@mit-sdg/sync-engine/tooling`  | `WireProjection`, `WireProjectionResult`, `WireContractsIR`, `WireType`                                                                                           |
| `@mit-sdg/sync-engine/client`   | `createClient`, `ClientTransport`, `ClientResponseValidator`, `ContractShape`                                                                                     |

`bindTransport(...)` returns a `TransportBinding`; use its `invoker.invoke` and
`routes` members to connect the protocol to an application. This is a supported
tier, not a deep-import workaround.

## Host responsibilities and unsupported features

The host owns listener and process lifecycle, static or SPA routing, TLS, proxy
configuration, and traffic controls. Application code defines credentials,
authentication, and authorization.

The package does not provide a Node cookie jar, retries, idempotency, rollback,
persistence, or cancellation of accepted application work. It buffers JSON
request and response bodies. Resource-oriented REST routing, streaming, and
arbitrary framework adapters are unsupported. Generated TypeScript does not
provide runtime validation.

The handler and client have no disposal method. The host closes listeners, Fetch
agents, gateways, stores, and other resources. Handler calls and client header
providers may overlap; the application and host must provide required
serialization.

## Migration to the current API

There are no aliases or compatibility adapters.

### Removed identifiers

| Removed                            | Replacement                         |
| ---------------------------------- | ----------------------------------- |
| `@mit-sdg/sync-engine-http/server` | `@mit-sdg/sync-engine-http/handler` |
| `productionHttpProfile`            | `httpPolicy`                        |
| `ProductionHttpProfile`            | `HttpPolicyInit` / `HttpPolicy`     |
| `HttpPublicErrorPolicy`            | folded into `HttpPolicyInit`        |
| `httpFloor`                        | `httpPolicy({ cookies })`           |
| `HttpFloor`                        | `HttpPolicy`                        |
| `HttpCredentialBinding`            | `HttpCookieBinding`                 |
| `createHttpHandler({ profile })`   | `createHttpHandler({ policy })`     |
| `createHttpHandler({ floor })`     | `createHttpHandler({ policy })`     |

### Renamed fields

| Before                          | After                                   |
| ------------------------------- | --------------------------------------- |
| `origin`                        | `publicOrigin` (conditionally required) |
| `credential`                    | `cookies.<name>`                        |
| `credential.issue` (one object) | `cookies.<name>.issue` (array)          |
| `credential.issue.output`       | `cookies.<name>.issue[].value`          |
| `credential.name`               | `cookies.<name>.name`                   |

### Changed behavior

| Change                                                                                    | Effect                                                                             |
| ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Raw mutable policies rejected                                                             | Construct policy values with `httpPolicy(...)`.                                    |
| `SameSite` derived; `None` under a credentialed browser policy                            | Cross-origin browser session policy no longer silently receives `Strict`.          |
| HTTPS-or-loopback required whenever cookies are declared                                  | Cookie policy no longer depends on `NODE_ENV`.                                     |
| Client default `credentials: "same-origin"`                                               | Cross-origin browser clients must select `"include"`.                              |
| Clearing scoped to applicable bindings; `FORBIDDEN` excluded                              | Authorization refusal no longer signs out a valid session.                         |
| Construction rejects overlapping bindings, inert bindings, and optional credential inputs | Previously accepted assemblies may fail during handler binding or wire projection. |

## Support and security

Only the newest beta is supported. Pin exact matching core and HTTP versions,
and review the repository changelog before upgrading. Report suspected
vulnerabilities through the repository's [private reporting
process](https://github.com/mit-sdg/sync-engine/blob/main/SECURITY.md).

## Related documentation

- [HTTP public API reference](public-surface.md)
- [Complete message-board application](https://github.com/mit-sdg/sync-engine/blob/main/examples/message-board/README.md)
- [Boundary, gateway, and client semantics](https://github.com/mit-sdg/sync-engine/blob/main/docs/user/reference/semantics.md#boundary-gateway-and-client)
- [Core operational limits](https://github.com/mit-sdg/sync-engine/blob/main/docs/user/reference/operations.md)
