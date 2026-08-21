# HTTP projection and hosting

`@mit-sdg/sync-engine-http` exposes an assembled application over POST/JSON. Its policy
derives CORS, request-origin checks, cookie attributes, direct GET routes, public error
mapping, and wire projection. Authentication and authorization stay in concepts and
composition.

Matching HTTP support must already be installed in the application. If it is absent or
incompatible, report an environment blocker instead of installing or replacing it. Do
not implement a parallel product router, call concepts directly from the host, or copy
HTTP policy into a hand-written Fetch handler.

## Declare the boundary

Every operation remains a sync-engine `endpoint` built from `receive` and `respond`. A
direct browser GET route maps to an unchanged endpoint; the HTTP package does not replace
endpoint declarations. The approved design must first link that endpoint as a reaction,
for example:

```text
Resolving a short code [enters the application](reaction:LinkShortener.Links.Resolve).
```

The source declaration uses that exact final name:

```ts
import { endpoint, receive, respond } from "@mit-sdg/sync-engine/boundary";
import { where } from "@mit-sdg/sync-engine/language";
import { concepts } from "../concepts.ts";

const Resolve = endpoint("/links/resolve", ({ code, target }) =>
  receive({ code }).then(
    where(concepts.Links._resolve({ code }).is({ target })).then(respond({ target })),
  ),
);

export const composition = { Links: { Resolve } };
```

Assembly registers the exported group record under the linked module:

```ts
assemble({
  conceptSet: applicationConceptSet,
  instances: applicationConceptSet.implementations(),
  composition: { LinkShortener: composition },
});
```

Use the approved concepts, endpoint paths, conditions, response fields, validators, and
composition names; the example supplies API shape, not product policy. If the endpoint's
reaction link is absent, stop with a design blocker before writing the declaration.

## Define one policy and projection

Construct policy with `httpPolicy` from `@mit-sdg/sync-engine-http/policy`. Map only
caller-visible refusal codes. A browser-followed link uses `direct`; each `{name}` fills
the endpoint input, and `redirect` names an absolute-URL response field. Direct routes are
GET-only and redirect with 302.

```ts
import { httpPolicy } from "@mit-sdg/sync-engine-http/policy";

export const appHttpPolicy = httpPolicy({
  publicErrors: {
    INVALID_URL: "INVALID_REQUEST",
    NOT_FOUND: "NOT_FOUND",
    INVALID_SECRET: "FORBIDDEN",
    ALIAS_EXISTS: "CONFLICT",
  },
  direct: [{ method: "GET", path: "/{code}", endpoint: "/links/resolve", redirect: "target" }],
});
```

Add `httpWire` to the generated config and use the same policy at runtime:

```ts
import { httpWire } from "@mit-sdg/sync-engine-http/tooling";
import { assembleApplication } from "./src/assembly.ts";
import { appHttpPolicy } from "./src/http-policy.ts";

export default {
  assemble: assembleApplication,
  title: "Application",
  wireName: "AppWire",
  design: {
    version: 1,
    documents: [
      new URL("./design/types.md", import.meta.url),
      new URL("./design/composition.md", import.meta.url),
    ],
  },
  projections: [httpWire({ policy: appHttpPolicy, name: "AppWireHttp" })],
};
```

Run the project's generation command; never edit generated wire output.

## Bind gateway, handler, and host

Create a typed gateway from the generated wire, pass it with the same assembled
application and policy to the package handler, then give that handler to `Bun.serve`:

```ts
import { createGateway } from "@mit-sdg/sync-engine/boundary";
import { createHttpHandler } from "@mit-sdg/sync-engine-http/handler";
import type { AppWire } from "../generated/wire.ts";
import { assembleApplication } from "./assembly.ts";
import { appHttpPolicy } from "./http-policy.ts";

export function createApplicationHttpHandler() {
  const application = assembleApplication();
  const gateway = createGateway<AppWire>({ application });
  return createHttpHandler({ application, gateway, policy: appHttpPolicy });
}

export function startHost(hostname = "localhost", port = 3000) {
  return Bun.serve({ hostname, port, fetch: createApplicationHttpHandler() });
}
```

The package handler accepts POST/JSON by endpoint pathname. Without policy it emits no
CORS or cookie headers, limits bodies to 1 MiB, and maps private failures to
`INTERNAL_ERROR`. `httpPolicy` owns CORS, request-origin checks, cookie attributes,
limits, direct routes, and public error categories; do not duplicate them in host code.
Tests for an HTTP application exercise this package handler or the actual listener, not a
substitute handler with the same name.
