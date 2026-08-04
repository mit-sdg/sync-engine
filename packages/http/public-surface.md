# Public API

This reference lists every supported package subpath and export for
`@mit-sdg/sync-engine-http`. The package has no root export and no supported
deep import. The export registers are exact; compact signatures and tables
summarize the principal call shapes and do not replace the generated TypeScript
declarations.

The [core public API reference](https://github.com/mit-sdg/sync-engine/blob/main/docs/user/reference/public-api.md)
defines the supported core subpaths and transport-neutral contracts.

Install the maintained companion explicitly:

```sh
bun add @mit-sdg/sync-engine@beta @mit-sdg/sync-engine-http@beta
```

Pin both selectors to the same exact beta for reproducibility. The independently
published companion declares an exact matching beta core peer dependency. It is
ESM-only and supports these three entrypoints.

| Package path                                    | Role                           |
| ----------------------------------------------- | ------------------------------ |
| [`@mit-sdg/sync-engine-http/server`](#server)   | First-party HTTP handler       |
| [`@mit-sdg/sync-engine-http/client`](#client)   | First-party fetch client       |
| [`@mit-sdg/sync-engine-http/tooling`](#tooling) | Generated HTTP wire projection |

## `server`

<!-- register:http-server:start -->

`HttpCorrelationOptions`, `HttpCredentialBinding`, `HttpFloor`, `HttpPublicErrorCategory`, `HttpPublicErrorPolicy`, `ProductionHttpProfile`, `createHttpHandler`, `httpFloor`, `productionHttpProfile`

<!-- register:http-server:end -->

```ts
productionHttpProfile(declaration: ProductionHttpProfile): ProductionHttpProfile
httpFloor(declaration: HttpFloor): HttpFloor
createHttpHandler(options: {
  application: Assembly<Record<string, new (...args: never[]) => object>>;
  gateway: Gateway<ContractShape>;
  profile: ProductionHttpProfile;
  correlation?: HttpCorrelationOptions;
}): (request: Request) => Promise<Response>
createHttpHandler(options: {
  application: Assembly<Record<string, new (...args: never[]) => object>>;
  gateway: Gateway<ContractShape>;
  floor: HttpFloor;
  correlation?: HttpCorrelationOptions;
}): (request: Request) => Promise<Response>
```

| Profile field  | Required | Meaning                                                        |
| -------------- | -------- | -------------------------------------------------------------- |
| `origin`       | yes      | Absolute HTTP or HTTPS origin with no path, query, or fragment |
| `basePath`     | no       | Portable route prefix; omitted or `/` means no prefix          |
| `publicErrors` | no       | Domain refusal code to public HTTP category                    |

`origin` must contain only an absolute HTTP or HTTPS origin. When
`NODE_ENV=production`, it must use HTTPS. `basePath` uses the core portable-path
grammar; `/` means no prefix, and trailing slashes are removed. A profile does
not use the inbound `Origin` header for authorization or CORS.

`HttpPublicErrorCategory` is `INVALID_REQUEST`, `UNAUTHORIZED`, `FORBIDDEN`,
`NOT_FOUND`, or `CONFLICT`. Those categories use status 400, 401, 403, 404, and
409 respectively. Private or unknown refusal codes and non-string domain-error
values use `INTERNAL_ERROR`/500. Framework `INVALID_INPUT` uses
`INVALID_REQUEST`/400 and framework `NOT_FOUND` uses `NOT_FOUND`/404; other
framework server failures use `INTERNAL_ERROR`/500. Public failure bodies
contain only `{ error }`.

### Handler behavior

The handler accepts only `POST`. A missing `Content-Type` is accepted; a present
value must be `application/json`, optionally with parameters. An unsupported
method or media type returns `INVALID_REQUEST`/400. Routing uses `URL.pathname`
after removing `basePath`; query parameters do not select another route, and a
path outside the base returns `NOT_FOUND`/404.

An empty request body becomes `{}`. The handler rejects an unreadable or
malformed body, a declared body over 1,048,576 bytes, or a stream that exceeds
that limit while being read with `INVALID_REQUEST`/400. It passes
`Request.signal` to the invoker. The signal ends invocation waiting but does not
roll back or cancel accepted concept work.

Every response has `Content-Type: application/json`; successful invocations use
status 200. An invoker rejection or response serialization failure becomes
opaque `INTERNAL_ERROR`/500. With a production profile, a successful value is
otherwise serialized with `JSON.stringify`: `Date` values become strings and
`undefined` object fields disappear. A value for which serialization throws or
returns `undefined` becomes `INTERNAL_ERROR`/500. A credential floor additionally
consumes the fields described below.

`HttpCorrelationOptions.resolve(request)` runs synchronously for each request.
An accepted correlation id is a nonempty ByteString of at most 128 code units,
contains no control characters, and has no leading or trailing space. A missing,
invalid, or faulting result is replaced with a UUID. `responseHeader`, when
supplied, must be a valid header name. The handler does not replace an existing
response header, and a decoration failure does not reject the request. The
effective id is also passed to gateway and application observation.

`createHttpHandler(...)` rejects a gateway that does not target `application`.
Handler calls may overlap. The handler has no disposal method and does not own
the application, gateway, concept store, listener, or other host resources.

### Credential floor

`HttpFloor` adds a `credential` field with the following shape:

```ts
credential: {
  readonly name: string;
  readonly input: string;
  readonly issue: { readonly path: string; readonly output: string; readonly expires: string };
  readonly clear: readonly string[];
}
```

An endpoint is protected only when its input contract lists `credential.input`
as required. The paths in `credential.clear` must be distinct, and
`credential.issue.path` must not also appear in `credential.clear`. The issue and
clear paths must exist, at least one endpoint must be protected, and every
top-level issue-output alternative must contain the token and expiry fields.
Credential and issue-output names must be JavaScript-style identifiers.

`httpFloor(...)` validates field names, portable path syntax, and issue/clear
distinctness when the floor is constructed. `createHttpHandler(...)` then
validates endpoint existence, protected-route presence, and issue-output fields
synchronously against its assembly. `httpWire(...).project(facts)` performs the
same assembly-dependent checks when the artifact planner evaluates the
projection.

For a protected endpoint, the handler replaces the credential input with the
cookie value or `null`; it never accepts that field from the request body. The
floor checks the declared origin only when an inbound `Origin` header is present
and returns `FORBIDDEN`/403 for a mismatch. It does not require `Origin`, compare
the origin with `request.url`, answer CORS preflight, or emit CORS headers.

On the issuing endpoint, the credential output must be a string and the expiry
must be a valid `Date` or a value whose string representation is date-parsable.
Invalid issue output becomes `INTERNAL_ERROR`/500. The handler removes both
fields from the response and writes the credential cookie. Successful clear
endpoints and an `UNAUTHORIZED` result from a protected endpoint clear the
cookie. Issue and clear responses use `Cache-Control: no-store`.

Cookies are `HttpOnly`, `SameSite=Strict`, and scoped to `Path=/` with no
`Domain`. An HTTPS origin adds `Secure` and prefixes the name with `__Host-`.
The floor adds no implicit `/api` prefix.

## `client`

<!-- register:http-client:start -->

`HeadersOption`, `HttpClientError`, `HttpClientErrorCode`, `HttpClientOptions`, `HttpRequestContext`, `createHttpClient`, `createHttpTransport`

<!-- register:http-client:end -->

```ts
createHttpTransport(options?: HttpClientOptions): ClientTransport<HttpClientError>
createHttpClient<Contract extends ContractShape>(options?: HttpClientOptions): Client<Contract, HttpClientError>
```

| `HttpClientOptions` field | Default / effect                                                                  |
| ------------------------- | --------------------------------------------------------------------------------- |
| `baseUrl`                 | `API_BASE_URL`, then `/api`; `/` selects the origin root; trailing `/` is removed |
| `fetch`                   | `globalThis.fetch`                                                                |
| `headers`                 | Record or provider called once per request with `HttpRequestContext`              |
| `credentials`             | `"include"`                                                                       |
| `validateResponse`        | `createHttpClient` only; optional synchronous check of the complete parsed result |
| `maxResponseBytes`        | No cap; otherwise a positive finite integer limiting buffered response bytes      |

The client or transport resolves `baseUrl`, including `API_BASE_URL`, once when
constructed. Later environment changes do not alter it.

The transport sends JSON `POST` requests. Per-request headers are merged after
the initial `Content-Type: application/json` header and can replace it. Input is
serialized as `JSON.stringify(input ?? {})`, with the same `Date` and `undefined`
projection as the handler. A thrown request-serialization failure resolves as
`NETWORK_ERROR` before a response is obtained. An empty response body becomes
`{}`. A nonempty body must be JSON; response
`Content-Type` is not consulted. A non-2xx JSON object with an `error` property
is returned as the server result. A non-2xx response without that envelope uses
`BAD_STATUS`.

`HttpRequestContext` contains `path` and the call's effective `signal`,
`timeoutMs`, and `correlationId` when present. The package does not create a
correlation header; a header provider must project `correlationId` explicitly.
`timeoutMs` is local to the HTTP transport. Its timer starts before header
resolution and covers asynchronous header resolution, Fetch, and response-body
reading. Expiry resolves as core `TIMED_OUT`. The value must be a positive finite
integer no greater than `2_147_483_647` milliseconds, the reliable Node timer
maximum; a value outside that range resolves as core `INVALID_INPUT` before
header resolution or Fetch. This timer does not configure or relax gateway and
application invocation limits.

An invalid `maxResponseBytes` throws while constructing the client or transport.
For a valid cap, the transport rejects an oversized declared `Content-Length`
before buffering and counts streamed bytes when the declaration is absent or too
small. On overflow it cancels the response body where possible, without waiting
for cancellation, and resolves as `RESPONSE_TOO_LARGE`.

| `HttpClientErrorCode`      | Condition                                             |
| -------------------------- | ----------------------------------------------------- |
| `HEADER_RESOLUTION_FAILED` | The per-request header provider threw or rejected     |
| `NETWORK_ERROR`            | Fetch failed before a response was obtained           |
| `BAD_JSON`                 | The response body could not be read or parsed as JSON |
| `BAD_STATUS`               | A non-2xx response lacked a JSON error envelope       |
| `RESPONSE_TOO_LARGE`       | Declared or streamed response bytes exceeded the cap  |

Abort is a core client condition and resolves as `ABORTED`.
`HttpClientErrorCode` covers HTTP transport failures. Abort or timeout can settle
while an asynchronous header provider is still pending; the package cannot
cancel that provider. Either condition stops local transport waiting but does
not establish cancellation or rollback of accepted server work. The handler
passes its host-provided `Request.signal` to the invoker, but the HTTP protocol
adds no server-work cancellation message.

`createHttpClient` forwards `validateResponse` to the core client, which checks
the complete parsed success-or-error result without transforming an accepted
value. A `{ ok: false }` result, throw, or asynchronous validator result resolves
as core `TRANSPORT_ERROR`; no validator is inferred from the generated contract.
`createHttpTransport` alone does not apply `validateResponse`; pass the validator
to the surrounding `createClient` instead. In Node.js, the selected `fetch`
implementation must provide cookie storage if a credential floor requires
browser-like cookie persistence.

Header providers for concurrent calls may run concurrently. The client and
transport have no disposal method and do not own the selected Fetch
implementation or its agent resources.

## `tooling`

<!-- register:http-tooling:start -->

`HttpWireOptions`, `httpWire`

<!-- register:http-tooling:end -->

```ts
httpWire(options: { policy: ProductionHttpProfile | HttpFloor; name: string }): WireProjection
```

Reuse the immutable value returned by `productionHttpProfile(...)` or
`httpFloor(...)` in `createHttpHandler(...)` and `httpWire(...)`. The projector
derives public HTTP categories and, for a floor, omits the cookie-provided input
and consumed issue outputs. A raw mutable policy is structurally accepted and
snapshotted when `httpWire(...)` is constructed; later mutation does not change
generated output.

The projection maps each known refusal code through the policy; an unmapped code
becomes `INTERNAL_ERROR`. An endpoint with an open domain-error branch also
contributes `INTERNAL_ERROR` to the projected wire, even when no known private
refusal code contributes that category.

This page defines the package's POST, JSON, body-size, origin, status, cookie,
correlation, and Fetch behavior. Core [execution
semantics](https://github.com/mit-sdg/sync-engine/blob/main/docs/user/reference/semantics.md#boundary-gateway-and-client)
define invoker settlement and accepted-work cancellation. The [production
example](https://github.com/mit-sdg/sync-engine/tree/main/examples/production-http)
shows the complete lifecycle.
