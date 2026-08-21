# HTTP projection and hosting

`@mit-sdg/sync-engine-http` exposes an assembled application over POST/JSON. Its policy
derives CORS, request-origin checks, cookie attributes, and wire projection;
authentication and authorization stay in concepts and composition.

Matching `@mit-sdg/sync-engine-http` support must already be installed by the coordinator.
If it is absent or incompatible, report an environment blocker instead of installing or
replacing it.

Add `httpWire({ policy, name: "AppWireHttp" })` from
`@mit-sdg/sync-engine-http/tooling` to generated-config projections and regenerate. Host
the assembly with `createGateway`, `createHttpHandler({ application, gateway, policy })`,
and `Bun.serve({ hostname, port, fetch: handler })`. The host routes the complete request
URL to the handler and may serve frontend assets beside `basePath`.

The handler accepts POST/JSON by pathname. Without policy it emits no CORS or cookie
headers, limits bodies to 1 MiB, and maps private failures to `INTERNAL_ERROR`.

A browser-followed link reaches an unchanged endpoint through a policy `direct` GET
route. Each `{name}` fills the endpoint input. A route states a JSON status or a redirect
field containing an absolute URL; it carries no cookies or request-origin check and
cannot serve a cookie endpoint.

`httpPolicy(init)` freezes `publicOrigin`, `basePath`, `publicErrors`, browser CORS,
`requestOrigins`, cookies, limits, and direct routes. Map distinguishable refusal codes
to `INVALID_REQUEST`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, or `CONFLICT`; unmapped
errors remain private. A cookie binding names its cookie and supplied endpoint input,
plus issuing endpoints' value/expiry fields and clearing endpoints.
