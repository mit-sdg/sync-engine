# HTTP hosting and clients

`@mit-sdg/sync-engine-http` exposes an assembled application over POST/JSON. Install
it at the exact installed core version; the two packages upgrade together. Its policy
derives CORS, request-origin checks, cookie attributes, and the wire projection. It
never authenticates users or authorizes operations: those stay in concepts and
composition.

## Wire projection

Add the HTTP projection to the generated config, then regenerate artifacts with the
standard `generate` script:

```ts
import { httpWire } from "@mit-sdg/sync-engine-http/tooling";

export default {
  assemble,
  wireName: "AppWire",
  design: { version: 1, documents: [/* ... */] },
  projections: [httpWire({ policy, name: "AppWireHttp" })],
};
```

## Host

```ts
import { createGateway } from "@mit-sdg/sync-engine/boundary";
import { createHttpHandler } from "@mit-sdg/sync-engine-http/handler";

const gateway = createGateway({ application });
const handler = createHttpHandler({ application, gateway, policy });
Bun.serve({ hostname, port, fetch: handler });
```

The handler accepts POST/JSON and selects endpoints by pathname; the host owns the
listener, routes the complete request URL to `handler(request)`, and may serve static
frontend assets beside the policy's `basePath`. Without a policy there are no CORS or
cookie headers, bodies are limited to 1 MiB, and private failures become
`{ "error": "INTERNAL_ERROR" }`.

## Direct routes

A client that cannot post — a browser following a link — reaches an endpoint through a
policy `direct` route. The endpoint is unchanged; the route says how its value is served.

```ts
direct: [{ method: "GET", path: "/{code}", endpoint: "/resolve", redirect: "target", status: 307 }];
```

Each `{name}` fills the endpoint input of that name. `redirect` names a response field
holding an absolute URL and answers 302, or the `status` the route also states. Without
`redirect`, `status` answers that status with the JSON body. A route states at least one. GET only. The endpoint keeps its POST path, and a direct
route carries no cookies and no request-origin check, so it cannot serve a cookie endpoint.

## Policy

`httpPolicy(init)` from `@mit-sdg/sync-engine-http/policy` freezes deployment facts:
`publicOrigin`, `basePath`, `publicErrors`, `browser` CORS, `requestOrigins`,
`cookies`, and `limits`. Map each refusal code a caller must distinguish to
`INVALID_REQUEST`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, or `CONFLICT`; unmapped
errors stay private. A cookie binding names the cookie, the endpoint input it
supplies, the endpoints issuing it with value and expiry result fields, and the
endpoints clearing it:

```ts
cookies: {
  session: {
    name: "app-session",
    input: "session",
    issue: [{ path: "/auth/sign-in", value: "session", expires: "expiresAt" }],
    clear: ["/auth/sign-out"],
  },
},
```

## Web frontend client

```ts
import type { Client } from "@mit-sdg/sync-engine/client";
import { createHttpClient, type HttpClientError } from "@mit-sdg/sync-engine-http/client";
import type { AppWireHttp } from "../generated/wire.ts";

const client: Client<AppWireHttp, HttpClientError> = createHttpClient({ baseUrl: "/api" });
const result = await client.board.list({});
if ("error" in result) return show(result.error);
```

Endpoint groups follow the wire contract; hyphenated names use indexed access such as
`client.board["retract-comment"]`. Every result is a union: discriminate with
`"error" in result` before reading fields. Calls accept an optional second
`{ signal, timeoutMs, correlationId }` argument.

## Command-line or in-process client

`createLocalClient<Wire>({ invoker: gateway })` from `@mit-sdg/sync-engine/client`
returns the same typed client over the same generated contract without HTTP. Either
way the frontend reaches the application only through its endpoints.
