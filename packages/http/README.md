# @mit-sdg/sync-engine-http

`@mit-sdg/sync-engine-http` is the maintained Fetch-based HTTP transport for
`@mit-sdg/sync-engine`. It provides a server adapter, a fetch client, and a
generated-wire projection. It does not provide an HTTP listener or web
framework integration.

Stable 1.x requires Node.js 24 and ESM. This independently published package
declares `@mit-sdg/sync-engine@^1.0.0` as its core peer dependency. For an exact
reproducible installation:

```sh
bun add @mit-sdg/sync-engine@1.0.0 @mit-sdg/sync-engine-http@1.0.0
```

Use `@latest` for the current installation.

The package has no root export. Use only these subpaths:

- `@mit-sdg/sync-engine-http/server`
- `@mit-sdg/sync-engine-http/client`
- `@mit-sdg/sync-engine-http/tooling`

## Production profile

`productionHttpProfile(...)` defines the public origin, optional route prefix,
and domain errors that may cross the HTTP boundary. Pass the same immutable
profile to the handler and wire projector.

```ts
import { createGateway } from "@mit-sdg/sync-engine/boundary";
import { createHttpHandler, productionHttpProfile } from "@mit-sdg/sync-engine-http/server";
import { httpWire } from "@mit-sdg/sync-engine-http/tooling";
import { assembleApplication } from "./src/assembly.ts";

export const httpPolicy = productionHttpProfile({
  origin: "https://app.example",
  basePath: "/api",
  publicErrors: { DUPLICATE_NAME: "CONFLICT" },
});

const application = assembleApplication();
const gateway = createGateway({ application });
export const handler = createHttpHandler({
  application,
  gateway,
  profile: httpPolicy,
});

export default {
  assemble: assembleApplication,
  title: "Application",
  projections: [httpWire({ policy: httpPolicy, name: "ApplicationWireHttp" })],
};
```

The handler accepts JSON `POST` requests. It limits request bodies to 1,048,576
bytes and returns JSON. Public domain categories are `INVALID_REQUEST`,
`UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, and `CONFLICT`, with status 400, 401,
403, 404, and 409 respectively. Unknown or private refusals and most framework
failures become `INTERNAL_ERROR`/500 without diagnostic detail. Framework input
and route failures become `INVALID_REQUEST`/400 and `NOT_FOUND`/404.

The configured origin must be an absolute HTTP or HTTPS origin. Production mode
requires HTTPS. A credential-free profile does not use the inbound `Origin`
header for authorization or CORS.

## Fetch client

```ts
import { createHttpClient } from "@mit-sdg/sync-engine-http/client";
import type { ApplicationWireHttp } from "./generated/wire.ts";

const client = createHttpClient<ApplicationWireHttp>({ baseUrl: "/api" });
const result = await client.names.claim({ name: "Ada" });
```

`baseUrl` defaults to `API_BASE_URL`, then `/api`. An explicit `/` means no
prefix. The client uses `globalThis.fetch`, sends JSON `POST` requests, and uses
Fetch credentials mode `include` by default. `headers` may be a record or a
synchronous or asynchronous provider called for each request.

Calls resolve to a success value or error envelope. The HTTP-client errors are:

| Code                       | Condition                                             |
| -------------------------- | ----------------------------------------------------- |
| `HEADER_RESOLUTION_FAILED` | The header provider threw or rejected                 |
| `NETWORK_ERROR`            | Fetch failed before a response was obtained           |
| `BAD_JSON`                 | The response body could not be read or parsed as JSON |
| `BAD_STATUS`               | A non-2xx response lacked a JSON error envelope       |

Abort resolves as the core `ABORTED` error. An empty response body becomes `{}`.
A non-2xx JSON object with an `error` property is returned as the server result.
The client does not runtime-validate response values against generated types.

## Cookie credential floor

`httpFloor(...)` adds one cookie-provided logical credential. Its declaration
names the credential input, the endpoint and output fields that issue the
credential, and successful endpoints that clear it:

```ts
import { httpFloor } from "@mit-sdg/sync-engine-http/server";

export const httpPolicy = httpFloor({
  origin: "https://app.example",
  basePath: "/api",
  publicErrors: { INVALID_SESSION: "UNAUTHORIZED" },
  credential: {
    name: "session",
    input: "sessionToken",
    issue: { path: "/sessions/start", output: "sessionToken", expires: "expiresAt" },
    clear: ["/sessions/end"],
  },
});
```

An endpoint is protected only when its input contract lists the credential input
as required. The handler replaces that input with the cookie value and never
trusts a body-supplied value. The projector removes the credential input and
consumed issue outputs from the public generated contract.

The floor checks the configured origin only when the request contains an
`Origin` header. It does not implement CORS or require that header. Cookies are
`HttpOnly`, `SameSite=Strict`, and `Path=/`; HTTPS cookies are `Secure` and use
the `__Host-` prefix. Issuance, clearing, and unauthorized protected responses
use `Cache-Control: no-store`.

Browser fetch owns browser cookie storage. Node.js fetch does not supply a
browser-style cookie jar; a Node.js or custom fetch implementation must provide
cookie persistence when calls depend on the floor.

## Host responsibilities

The handler adds no listener lifecycle, TLS termination, CORS, HSTS, proxy
trust, connection limits, rate limits, retries, deduplication, or idempotency.
Handler calls may overlap, and client header providers may run concurrently.
The handler and client have no disposal method and do not own application,
gateway, store, listener, or fetch-agent lifetime.

See the [HTTP API reference](https://github.com/mit-sdg/sync-engine/blob/main/docs/public-surface.md#http-companion-package),
[execution semantics](https://github.com/mit-sdg/sync-engine/blob/main/docs/semantics.md#boundary-gateway-and-client),
[host responsibilities](https://github.com/mit-sdg/sync-engine/blob/main/docs/operations.md#http-host-responsibilities),
and [complete production example](https://github.com/mit-sdg/sync-engine/tree/main/examples/production-http).
