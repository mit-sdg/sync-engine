# @mit-sdg/sync-engine-http

`@mit-sdg/sync-engine-http` is the maintained Fetch-based HTTP transport for
`@mit-sdg/sync-engine`. It provides a server adapter, a fetch client, and a
generated-wire projection. It does not provide an HTTP listener or web
framework integration.

The current 1.x beta requires Node.js 24 and ESM. This independently published package
declares an exact matching beta core peer dependency. Install both packages with
the current release:

```sh
bun add @mit-sdg/sync-engine@beta @mit-sdg/sync-engine-http@beta
```

For reproducibility, replace `@beta` with the same pinned beta version.

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

The profile projects only mapped domain errors and opaque protocol categories.
The [server reference](public-surface.md#server) defines request limits, status
mapping, origin rules, correlation, and failure behavior.

## Fetch client

```ts
import { createHttpClient } from "@mit-sdg/sync-engine-http/client";
import type { ApplicationWireHttp } from "./generated/wire.ts";

const client = createHttpClient<ApplicationWireHttp>({ baseUrl: "/api" });
const result = await client.names.claim({ name: "Ada" });
```

`baseUrl` defaults to `API_BASE_URL`, then `/api`; `/` selects the origin root.
Per-call options carry abort, timeout, and correlation values. Optional headers,
response-size limits, and response validation belong in `HttpClientOptions`.
Calls resolve handled transport failures as error envelopes. The [client
reference](public-surface.md#client) lists every default, limit, and error code.

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

The [credential-floor reference](public-surface.md#credential-floor) defines
origin checks, cookie attributes, issuance, clearing, and validation. Browsers
own their cookie storage; a Node.js or custom `fetch` must supply persistence
when calls depend on the floor.

## Host responsibilities

The handler adds no listener lifecycle, TLS termination, CORS, HSTS, proxy
trust, connection limits, rate limits, retries, deduplication, or idempotency.
Handler calls may overlap, and client header providers may run concurrently.
The handler and client have no disposal method and do not own application,
gateway, store, listener, or fetch-agent lifetime.

See the [HTTP API reference](public-surface.md),
[execution semantics](https://github.com/mit-sdg/sync-engine/blob/main/docs/user/reference/semantics.md#boundary-gateway-and-client),
[host responsibilities](https://github.com/mit-sdg/sync-engine/blob/main/docs/user/reference/operations.md#http-host-responsibilities),
[support policy](https://github.com/mit-sdg/sync-engine/blob/main/SUPPORT.md),
[security policy and private vulnerability reporting](https://github.com/mit-sdg/sync-engine/blob/main/SECURITY.md),
and [complete production example](https://github.com/mit-sdg/sync-engine/tree/main/examples/production-http).
