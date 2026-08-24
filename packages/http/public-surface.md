# Public API

`@mit-sdg/sync-engine-http` has no root export or supported deep imports. The
registers below are exact; generated declarations define complete structural
types.

Install the HTTP companion and core at the same exact beta version. The HTTP
package is ESM-only and supports Node.js 24 (`>=24 <25`).

| Package path                                    | Role                                  |
| ----------------------------------------------- | ------------------------------------- |
| [`@mit-sdg/sync-engine-http/policy`](#policy)   | Validated immutable deployment policy |
| [`@mit-sdg/sync-engine-http/handler`](#handler) | Fetch handler                         |
| [`@mit-sdg/sync-engine-http/client`](#client)   | Fetch transport and typed client      |
| [`@mit-sdg/sync-engine-http/tooling`](#tooling) | Generated HTTP wire projection        |

Policy supplies public and browser origins, public error mappings, and cookie
bindings. The package derives CORS, request-origin checks, cookie attributes,
and wire projection; it does not authenticate users or authorize operations.

## `policy`

<!-- register:http-policy:start -->

`HttpBrowserPolicy`, `HttpCookieBinding`, `HttpDirectRoute`, `HttpLimits`, `HttpPolicy`, `HttpPolicyBrand`, `HttpPolicyInit`, `HttpPublicErrorCategory`, `HttpRequestOriginPolicy`, `httpPolicy`

<!-- register:http-policy:end -->

### Direct routes

`direct` declares routes served outside POST/JSON, for clients that cannot post — a
browser following a link. The endpoint is unchanged: it still declares a value, and the
route declares how that value reaches the client.

```ts
httpPolicy({
  direct: [
    { method: "GET", path: "/{code}", endpoint: "/resolve", redirect: "target" },
    { method: "GET", path: "/{code}/stats", endpoint: "/report", status: 200 },
  ],
});
```

Each `{name}` segment fills the endpoint input of that name, percent-decoded, and an empty
segment does not match. `redirect` names a response field carrying an absolute URL and
answers `302` by default; `status` alone answers that status with the JSON body. A route
must state one of them. Only `GET` is supported, parameter names may not repeat, and two
routes may not share a method and shape. Malformed percent encoding does not match.
POST/JSON remains the default for everything else, and a declared route does not remove
its endpoint's POST path.

### `httpPolicy`

```ts
httpPolicy(init: HttpPolicyInit): HttpPolicy
```

`httpPolicy` validates and copies deployment facts into a frozen snapshot marked
with `HttpPolicyBrand`. Consumers reject raw structural objects.

```ts
interface HttpPolicyInit {
  readonly publicOrigin?: string;
  readonly basePath?: string;
  readonly publicErrors?: Readonly<Record<string, HttpPublicErrorCategory>>;
  readonly browser?: HttpBrowserPolicy;
  readonly requestOrigins?: HttpRequestOriginPolicy | false;
  readonly cookies?: Readonly<Record<string, HttpCookieBinding>>;
  readonly limits?: HttpLimits;
}
```

| Field                     | Accepted form and effect                                                                                                                            |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `publicOrigin`            | Exact absolute HTTP or HTTPS origin. Required for cookies and for `browser.credentials: true`; in either case it must use HTTPS or a loopback host. |
| `basePath`                | Portable absolute route prefix. Omission, `""`, and `"/"` select the origin root; trailing slashes are removed.                                     |
| `publicErrors`            | Own domain refusal code to public HTTP category. Unmapped, inherited, malformed, and non-string errors remain private.                              |
| `browser`                 | Exact browser origins and CORS facts.                                                                                                               |
| `requestOrigins`          | Cookie-path request-origin allowlist, or `false` to disable that control where permitted.                                                           |
| `cookies`                 | Nonempty record of named cookie bindings.                                                                                                           |
| `limits.requestBodyBytes` | Positive safe integer; defaults to 1,048,576 in the handler.                                                                                        |

`HttpPublicErrorCategory` is `INVALID_REQUEST`, `UNAUTHORIZED`, `FORBIDDEN`,
`NOT_FOUND`, or `CONFLICT`. Those categories map to status 400, 401, 403, 404,
and 409. `INTERNAL_ERROR` is package-derived and cannot be assigned in
`publicErrors`.

`publicOrigin` and every configured browser or request origin must contain only
an HTTP or HTTPS origin: no credentials, non-root path, query, or fragment.
Origins are normalized through `URL.origin` and must be distinct after
normalization. The accepted HTTP loopback hosts are `localhost`, `127.0.0.1`,
and `[::1]`.

### Browser policy and CORS

```ts
interface HttpBrowserPolicy {
  readonly origins: readonly string[];
  readonly credentials?: boolean;
  readonly allowedHeaders?: readonly string[];
  readonly exposedHeaders?: readonly string[];
  readonly maxAgeSeconds?: number;
}
```

`origins` is an exact allowlist. Wildcards are not accepted. Header names must
be valid and distinct without regard to case. `Content-Type` is added to
`allowedHeaders` when absent. `maxAgeSeconds` must be a non-negative safe
integer.

For an allowed request origin, the handler emits
`Access-Control-Allow-Origin`; it also emits
`Access-Control-Allow-Credentials: true` when `credentials` is true and emits
configured exposed headers. Every response processed under a browser policy
varies on `Origin`, including responses for missing or disallowed origins.

An `OPTIONS` request is treated as preflight only when a browser policy exists.
The path must name an application endpoint, the origin must be allowed, the
requested method must be `POST`, and every requested header must be allowed. An
accepted preflight returns 204 and advertises `POST, OPTIONS`; a rejected
preflight returns `FORBIDDEN`/403. Preflight responses also vary on
`Access-Control-Request-Method` and `Access-Control-Request-Headers`.

CORS controls browser response access, not authorization of cookie-bearing
requests; request-origin protection is separate.

### Request-origin protection

```ts
interface HttpRequestOriginPolicy {
  readonly allowed: readonly string[];
  readonly requireOrigin?: boolean;
}
```

The handler applies request-origin protection only to paths touched by a cookie
binding: protected, issue, and clear paths. When `requestOrigins` is omitted,
`allowed` defaults to `publicOrigin` plus `browser.origins`. An explicit
`allowed` list replaces that default and must include every browser origin.

A present `Origin` outside the allowlist returns `FORBIDDEN`/403. A missing
`Origin` is allowed by default. When `requireOrigin` is true, a missing `Origin`
on a cookie-touched path returns `FORBIDDEN`/403. Other paths are not checked by
this control.

`requestOrigins: false` disables request-origin protection. Policy construction
rejects that setting when a cookie uses derived or explicit `SameSite=None`.

### Cookie bindings

```ts
interface HttpCookieBinding {
  readonly name: string;
  readonly input: string;
  readonly issue: readonly {
    readonly path: string;
    readonly value: string;
    readonly expires: string;
  }[];
  readonly clear: readonly string[];
  readonly sameSite?: "Strict" | "Lax" | "None";
  readonly path?: string;
  readonly domain?: string;
}
```

Each binding must have a nonempty record key, a valid cookie `name`, a
JavaScript-style `input`, and at least one issue declaration. Issue `value` and
`expires` fields must be valid and distinct. Issue paths must be distinct,
clear paths must be distinct, and one binding cannot issue and clear on the same
path. Effective cookie names and logical inputs must be unique across bindings.
Cookie paths use the portable route-path grammar and cannot contain `;`, which
delimits cookie attributes. Domains must be plain domain names without a leading
dot.

Cookies always include `HttpOnly` and `Secure`. These attributes cannot be
overridden. `path` defaults to `/`; `domain` defaults to absent. A cookie whose
path is `/` and domain is absent receives `__Host-` unless its name already has
a valid secure prefix. Other cookies receive `__Secure-`. An explicit `__Host-`
name is rejected with an incompatible path or domain.

`SameSite` is derived from the presence of a credentialed browser policy, not by
comparing sites. No browser policy derives `Strict`.
`browser.credentials: true` derives `None`. Declaring cookies with a browser
policy whose `credentials` is absent or false is rejected. An explicit
`sameSite` override is accepted only when a browser policy is present.

`httpPolicy` does not know the application's endpoint contracts. The following
checks occur synchronously when `createHttpHandler` binds an application and
when `httpWire(...).project` projects one:

- issue and clear paths must name application endpoints;
- the bound input must be required by at least one endpoint;
- an endpoint cannot mention the bound input without requiring it;
- two cookies cannot protect the same endpoint;
- every issue endpoint output alternative must contain the declared value and
  expiry fields; and
- a direct route cannot serve a protected, issuing, or clearing endpoint.

## `handler`

<!-- register:http-handler:start -->

`HttpCorrelationOptions`, `HttpHandlerOptions`, `HttpResponseHeadersContext`, `createHttpHandler`

<!-- register:http-handler:end -->

### `createHttpHandler`

```ts
createHttpHandler(options: HttpHandlerOptions):
  (request: Request) => Promise<Response>

interface HttpHandlerOptions {
  readonly gateway: Gateway<ContractShape>;
  readonly application: Assembly<Record<string, new (...args: never[]) => object>>;
  readonly policy?: HttpPolicy;
  readonly correlation?: HttpCorrelationOptions;
  readonly responseHeaders?: HeadersInit | (
    (context: HttpResponseHeadersContext) =>
      HeadersInit | PromiseLike<HeadersInit>
  );
}
```

Omitting `policy` is equivalent to an empty policy. Supplying a non-branded raw
object throws. Handler construction binds `gateway` to `application`; binding
errors and application-dependent cookie-policy errors throw synchronously.

### Request handling

The handler accepts `POST` only. An `OPTIONS` request receives preflight
handling only under a browser policy. Every other method returns
`INVALID_REQUEST`/400; the handler does not emit an `Allow` header.

Routing uses `URL.pathname` after removing `basePath`. Query parameters do not
select a route. A path outside the base, a request for the base itself, or an
unknown POST path returns `NOT_FOUND`/404 without buffering a request body and
cancels the unread stream. Other rejections before body reading do the same. A
present `Content-Type` must be `application/json`, optionally with parameters;
omission is accepted. An empty body becomes `{}`. Malformed JSON or UTF-8,
unreadable, aborted, or oversized bodies return `INVALID_REQUEST`/400.

The handler buffers at most `limits.requestBodyBytes` request bytes, default
1,048,576. A numeric `Content-Length` larger than the limit fails before full
buffering; streamed bytes are counted independently. `Request.signal` stops a
pending body read and is passed with the effective correlation id to invocation.
Abort stops waiting but does not establish rollback or cancellation of accepted
application work.

A successful invocation returns status 200 and a JSON body. Serialization uses
core portable JSON serialization. An invocation throw, invalid cookie issue
value, invalid or non-future expiry, oversized serialized cookie, or response
serialization failure returns opaque `INTERNAL_ERROR`/500.

### Handler errors

| Result            | Status | Condition                                                                                                               |
| ----------------- | ------ | ----------------------------------------------------------------------------------------------------------------------- |
| `INVALID_REQUEST` | 400    | Invalid method, media type, body, body size, or framework input admission                                               |
| `UNAUTHORIZED`    | 401    | Domain refusal explicitly mapped to `UNAUTHORIZED`                                                                      |
| `FORBIDDEN`       | 403    | Domain mapping, rejected origin, or rejected preflight                                                                  |
| `NOT_FOUND`       | 404    | Route not found, including outside `basePath`                                                                           |
| `CONFLICT`        | 409    | Domain refusal explicitly mapped to `CONFLICT`                                                                          |
| `INTERNAL_ERROR`  | 500    | Private domain refusal, other framework failure, callback failure, serialization failure, or unexpected handler failure |

Public failure bodies contain only `{ error }`; domain details are not exposed.
Framework `INVALID_INPUT` maps to `INVALID_REQUEST`, and framework `NOT_FOUND`
maps to `NOT_FOUND`. Other framework failures are private.

### Cookie runtime behavior

For each protected path, the handler replaces the body field named by
`binding.input` with the decoded cookie or `null`. A non-object body on such a
path returns `INVALID_REQUEST`. Cookie headers larger than 16,384 bytes,
duplicate effective names, malformed percent encoding, and decoded values
outside printable ASCII are treated as an absent cookie.

On a successful issue path, the cookie value must be a printable ASCII string.
The expiry must be a `Date` or have a date-parsable string representation, and
must be in the future. The complete serialized cookie is limited to 4,096
bytes. The handler removes every issuing binding's value and expiry fields from
the JSON result. Successful issue and clear responses set
`Cache-Control: no-store`.

A successful clear path expires the configured cookie. An `UNAUTHORIZED`
response clears each binding that protects that path, whether or not a valid
cookie was present. `FORBIDDEN` and other failures do not clear cookies.

### Correlation and response headers

```ts
interface HttpCorrelationOptions {
  resolve(request: Request): string | undefined;
  responseHeader?: string;
}

interface HttpResponseHeadersContext {
  readonly request: Request;
  readonly path: string | undefined;
  readonly status: number;
  readonly correlationId?: string;
}
```

`resolve` runs synchronously once per request. A valid result is a nonempty
ByteString of at most 128 code units, contains no control character, and has no
leading or trailing space. A missing, invalid, or throwing result is replaced
with `crypto.randomUUID()`. When configured, `responseHeader` receives the
effective id unless the response already contains that header. The header name
must be valid and must not be reserved by HTTP policy.

`responseHeaders` may be static or computed asynchronously. An invalid static
header initializer throws during handler construction. A provider runs for
handled successes and failures. The handler drops cookie, cache, CORS,
representation, redirect, framing, and hop-by-hop headers from its result. This
includes `Set-Cookie`, `Cache-Control`, `Content-Type`, `Content-Encoding`,
`Content-Length`, `Location`, `Vary`, every `Access-Control-*` header, and
connection-specific fields. A provider throw, rejection, or invalid returned
initializer replaces the response with `INTERNAL_ERROR`/500; CORS and
correlation are then applied to that failure response.

Wrap the Fetch handler for preprocessing or response decoration. Wrappers are
outside the package's security boundary and can invalidate header and error
guarantees.

Handler calls may overlap. The handler has no disposal method. The caller owns
the application, gateway, and concept stores. The host owns the listener, static
files, TLS, process lifecycle, and other host resources. The host must route
complete Fetch requests to the handler, return its responses, and close every
resource that the host creates.

## `client`

<!-- register:http-client:start -->

`HeadersOption`, `HttpClientError`, `HttpClientErrorCode`, `HttpClientOptions`, `HttpRequestContext`, `createHttpClient`, `createHttpTransport`

<!-- register:http-client:end -->

```ts
createHttpTransport(options?: HttpClientOptions): ClientTransport<HttpClientError>
createHttpClient<Contract extends ContractShape>(
  options?: HttpClientOptions,
): Client<Contract, HttpClientError>
```

The client takes no policy and uses the generated projected wire type.

| `HttpClientOptions` field | Default and effect                                                                     |
| ------------------------- | -------------------------------------------------------------------------------------- |
| `baseUrl`                 | `API_BASE_URL`, then `/api`; `/` selects the origin root; trailing slashes are removed |
| `fetch`                   | `globalThis.fetch`                                                                     |
| `headers`                 | Header record or per-request synchronous/async provider                                |
| `credentials`             | `"same-origin"`; accepted values are `"include"`, `"omit"`, and `"same-origin"`        |
| `validateResponse`        | `createHttpClient` only; synchronous validation of the complete parsed result          |
| `maxResponseBytes`        | No cap; otherwise a positive finite integer                                            |

Options are resolved when the client or transport is constructed. Later changes
to `API_BASE_URL` do not alter the instance. The transport sends `POST`, adds
`Content-Type: application/json`, serializes `input ?? {}`, and passes the
configured credentials mode. Extra headers are merged afterward and may replace
`Content-Type`. Fetch redirects are rejected rather than followed, so configured
headers are not forwarded and the POST is not replayed at another URL.

`HeadersOption` providers receive `HttpRequestContext`: path, effective signal,
and the call's timeout and correlation id when supplied. The package does not
create a correlation request header. Header providers for concurrent calls may
run concurrently.

An empty response body becomes `{}`. A nonempty body must be valid UTF-8 and
parse as JSON; response `Content-Type` is not consulted. A non-2xx JSON object
with an `error` property is returned as the server result. A non-2xx response
without that envelope returns `BAD_STATUS`.

| `HttpClientErrorCode`      | Condition                                                          |
| -------------------------- | ------------------------------------------------------------------ |
| `HEADER_RESOLUTION_FAILED` | The header provider threw or rejected.                             |
| `NETWORK_ERROR`            | Fetch failed before a response was obtained, including a redirect. |
| `BAD_JSON`                 | The response body could not be read or parsed.                     |
| `BAD_STATUS`               | A non-2xx response lacked a JSON error envelope.                   |
| `RESPONSE_TOO_LARGE`       | Declared or streamed response bytes exceeded `maxResponseBytes`.   |

Abort and timeout use core error codes `ABORTED` and `TIMED_OUT`. `timeoutMs`
must be a positive finite integer no greater than 2,147,483,647; another value
returns core `INVALID_INPUT` before header resolution or Fetch. The timer covers
header resolution, Fetch, and body reading. Abort or timeout can settle while a
header provider or custom Fetch remains pending; neither proves that accepted
server work stopped.

A valid `maxResponseBytes` cap rejects an oversized numeric `Content-Length`
before buffering and counts streamed bytes. Overflow attempts to cancel the
response stream without waiting for cancellation. An invalid cap throws during
construction.

`createHttpClient` passes `validateResponse` to the core client. A false, thrown,
or asynchronous validation result returns core `TRANSPORT_ERROR`.
`createHttpTransport` alone does not apply that validator. The client does not
manage a Node cookie jar. The client and transport have no disposal method and
do not own Fetch agent resources.

## `tooling`

<!-- register:http-tooling:start -->

`HttpWireOptions`, `httpWire`

<!-- register:http-tooling:end -->

```ts
interface HttpWireOptions {
  readonly policy?: HttpPolicy;
  readonly name: string;
}

httpWire(options: HttpWireOptions): WireProjection
```

Omitting `policy` projects a plain JSON wire. A supplied policy must be a branded
value returned by `httpPolicy(...)`; a raw object throws when `httpWire` is
constructed. The projection name must satisfy core generated-contract naming
rules.

Projection maps each known refusal through `publicErrors`; an unmapped code and
an open domain-error branch contribute `INTERNAL_ERROR`. Cookie projection
removes each bound input from protected endpoints and removes value and expiry
fields from every issue endpoint. Application-dependent cookie validation runs
when the projection's `project(facts)` method executes, before artifacts are
compared or written.

Use the same policy for `createHttpHandler(...)` and `httpWire(...)`; the client
receives only the resulting generated type.

The [package README](README.md) provides tiered setup and the supported custom
transport building blocks. Core [execution semantics](https://github.com/mit-sdg/sync-engine/blob/main/docs/user/reference/semantics.md#boundary-gateway-and-client)
define invocation settlement and accepted-work cancellation. The package
[README](README.md#host-responsibilities-and-unsupported-features) defines HTTP
host responsibilities.
