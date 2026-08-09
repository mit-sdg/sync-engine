# @mit-sdg/sync-engine-http

Use `@mit-sdg/sync-engine-http` to expose an assembled sync-engine application as
POST/JSON endpoints and call those endpoints through a generated, typed Fetch
client. The package adapts Fetch `Request` objects to `Response` objects and
provides a client; it does not own an HTTP listener, web framework, or server
lifecycle.

## Mental model

```text
caller -> typed Fetch client -> HTTP -> Fetch handler -> gateway -> application
                 ^                         ^
                 |                         |
      generated HTTP wire type      immutable HTTP profile
                 ^                         |
                 +------ httpWire(profile)-+
```

The handler and client exchange JSON over HTTP. `httpWire(...)` applies the same
public profile as the handler to the application's logical wire contract. The
generated HTTP wire type then supplies the client's endpoint names, inputs,
outputs, and public error categories.

## What you get

| Part                      | Main export                   | Purpose                                                                         |
| ------------------------- | ----------------------------- | ------------------------------------------------------------------------------- |
| Fetch handler             | `createHttpHandler(...)`      | Routes a Fetch `Request` through a sync-engine gateway and returns a `Response` |
| Typed Fetch client        | `createHttpClient<Wire>(...)` | Exposes generated paths as typed methods and sends JSON `POST` requests         |
| HTTP wire projection      | `httpWire(...)`               | Generates the transport-visible contract from the logical wire                  |
| Production profile/policy | `productionHttpProfile(...)`  | Freezes the origin, route prefix, and public domain-error mapping               |
| Optional credential floor | `httpFloor(...)`              | Binds one logical credential to an `HttpOnly` cookie                            |

`createHttpTransport(...)` is also available when an application needs the HTTP
transport without the `createHttpClient(...)` convenience composition.

## Install

The HTTP package is published separately and declares an exact peer dependency
on the matching core beta. Pin both packages to the same exact version and
upgrade them together:

```sh
bun add --exact @mit-sdg/sync-engine@1.0.0-beta.8 @mit-sdg/sync-engine-http@1.0.0-beta.8
```

The current beta is ESM-only and supports Node.js 24 (`>=24 <25`).

## Import paths

The package has no root export. Deep imports are not supported; use one of these
public subpaths:

| Subpath                             | Contains                                      |
| ----------------------------------- | --------------------------------------------- |
| `@mit-sdg/sync-engine-http/server`  | Handler, production profile, credential floor |
| `@mit-sdg/sync-engine-http/client`  | Fetch client and lower-level HTTP transport   |
| `@mit-sdg/sync-engine-http/tooling` | Generated HTTP wire projection                |

## Quickstart

This quickstart assumes the application already exports `assembleApplication()`
and declares a `/names/claim` endpoint with a `{ name: string }` input and a
`NAME_TAKEN` refusal. The local module and generated type names below belong to
the application.

### 1. Create the profile and handler

```ts
// src/http-edge.ts
import { createGateway } from "@mit-sdg/sync-engine/boundary";
import { createHttpHandler, productionHttpProfile } from "@mit-sdg/sync-engine-http/server";
import { assembleApplication } from "./assembly.ts";

export const httpProfile = productionHttpProfile({
  origin: "https://app.example",
  basePath: "/api",
  publicErrors: { NAME_TAKEN: "CONFLICT" },
});

export function buildHttpEdge() {
  const application = assembleApplication();
  const gateway = createGateway({ application });
  const handler = createHttpHandler({
    application,
    gateway,
    profile: httpProfile,
  });

  return { application, gateway, handler };
}
```

`origin` declares the public HTTP or HTTPS origin, and production requires HTTPS;
it does not configure CORS. `basePath` exposes `/names/claim` at
`POST /api/names/claim`. `publicErrors` is an allowlist: `NAME_TAKEN` becomes
`CONFLICT`/409, while an unmapped domain error becomes opaque
`INTERNAL_ERROR`/500.

### 2. Give Fetch requests to the handler

A Fetch-native host can pass each request directly to the handler. The host then
sends the returned `Response` to the caller.

```ts
import { buildHttpEdge } from "./src/http-edge.ts";

const edge = buildHttpEdge();

export function respondToRequest(request: Request): Promise<Response> {
  return edge.handler(request);
}
```

Register `respondToRequest` with the host. No framework-specific adapter is
required when the host already uses Fetch interfaces.

### 3. Generate the HTTP wire type

Use the same immutable `httpProfile` value for the handler and `httpWire(...)`:

```ts
// generated.config.ts
import { httpWire } from "@mit-sdg/sync-engine-http/tooling";
import { assembleApplication } from "./src/assembly.ts";
import { httpProfile } from "./src/http-edge.ts";

export default {
  assemble: assembleApplication,
  title: "Application",
  wireName: "ApplicationWire",
  projections: [httpWire({ policy: httpProfile, name: "ApplicationWireHttp" })],
};
```

Generate or update the checked-in artifacts:

```sh
bunx sync-engine artifacts pin --config generated.config.ts
```

The projection emits `ApplicationWireHttp` in `generated/wire.ts` and replaces
private domain refusal names with the profile's public categories.

### 4. Call an endpoint through the typed client

```ts
import { createHttpClient } from "@mit-sdg/sync-engine-http/client";
import type { ApplicationWireHttp } from "./generated/wire.ts";

const client = createHttpClient<ApplicationWireHttp>({ baseUrl: "/api" });
const result = await client.names.claim({ name: "atlas" });

if ("error" in result) {
  console.error("Name claim failed:", result.error);
} else {
  console.log("Claimed:", result.name);
}
```

The client appends each generated endpoint path to `baseUrl`. If `baseUrl` is
omitted, the client uses `API_BASE_URL`, then `/api`; an explicit `/` selects the
origin root. Per-call options carry abort, timeout, and correlation values.
Headers, response-size limits, credentials mode, and optional response
validation belong in `HttpClientOptions`.

## Results and exceptions

Handled server failures become JSON `Response` objects. Public categories use
status 400 (`INVALID_REQUEST`), 401 (`UNAUTHORIZED`), 403 (`FORBIDDEN`), 404
(`NOT_FOUND`), or 409 (`CONFLICT`). Private domain errors and internal failures
use the opaque `INTERNAL_ERROR` category with status 500.

Endpoint calls resolve handled HTTP and client transport failures as error
envelopes. These include network failure, bad JSON, an unexpected status,
header-provider failure, response-size overflow, abort, and timeout. Check the
result's `error` property rather than relying on a rejected promise for these
conditions.

Invalid setup is a programmer or configuration error and throws while the
profile, floor, handler, or client is constructed. Examples include an invalid
origin or base path, a gateway for another application, an inconsistent
credential floor, or an invalid `maxResponseBytes`. Errors in the listener or
framework outside the Fetch adapter remain host errors.

## Optional cookie credential floor

Use `httpFloor(...)` when one required logical input should come from a browser
cookie instead of the JSON body. The application still owns the credential's
meaning, expiry, and authorization decisions.

```ts
// Alternative policy in src/http-edge.ts
import { httpFloor } from "@mit-sdg/sync-engine-http/server";

export const sessionFloor = httpFloor({
  origin: "https://app.example",
  basePath: "/api",
  publicErrors: { UNKNOWN_SESSION: "UNAUTHORIZED" },
  credential: {
    name: "session",
    input: "session",
    issue: {
      path: "/sessions/start",
      output: "session",
      expires: "expiresAt",
    },
    clear: ["/sessions/end"],
  },
});
```

Pass `floor: sessionFloor` instead of `profile: httpProfile` to
`createHttpHandler(...)`, and pass the same `sessionFloor` as the `policy` for
`httpWire(...)`.

An endpoint is protected only when its input contract lists `session` as
required. For such an endpoint, the handler replaces the input with the cookie
value or `null`; it never trusts a body-supplied value. The wire projection
removes that input from protected endpoints and removes `session` and
`expiresAt` from the issuing endpoint's public output.

The handler sets the cookie after successful issuance and clears it after a
successful configured clear endpoint or an `UNAUTHORIZED` result from a
protected endpoint. Browsers own cookie storage. `createHttpClient(...)` uses
`credentials: "include"` by default, but Node.js and custom Fetch
implementations must provide a cookie store when later calls depend on the
credential.

## Your host still owns

The host owns the listener, TLS termination, HSTS, CORS and preflight handling,
proxy trust, connection limits, rate limits, retries, idempotency, and startup,
drain, and shutdown policy. Handler calls may overlap, and client header
providers for concurrent calls may run concurrently; the host and application
must provide any required serialization.

The handler and client have no disposal method. They do not close the
application, gateway, concept store, listener, selected Fetch implementation, or
Fetch agent.

## Related documentation

- [HTTP public API reference](public-surface.md)
- [Complete production HTTP example](https://github.com/mit-sdg/sync-engine/tree/main/examples/production-http)
- [Boundary, gateway, and client semantics](https://github.com/mit-sdg/sync-engine/blob/main/docs/user/reference/semantics.md#boundary-gateway-and-client)
- [HTTP host responsibilities](https://github.com/mit-sdg/sync-engine/blob/main/docs/user/reference/operations.md#http-host-responsibilities)
- [Support policy](https://github.com/mit-sdg/sync-engine/blob/main/SUPPORT.md)
- [Security policy and private vulnerability reporting](https://github.com/mit-sdg/sync-engine/blob/main/SECURITY.md)
