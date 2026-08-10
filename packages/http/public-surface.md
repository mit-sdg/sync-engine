# HTTP public API

This reference defines every supported package subpath and export of
`@mit-sdg/sync-engine-http`. The package has no root export. Deep imports are
unsupported. The export registers below are exact; generated TypeScript
declarations remain authoritative for full inferred types.

Install the exact matching core and HTTP beta:

```sh
bun add --exact @mit-sdg/sync-engine@1.0.0-beta.8 @mit-sdg/sync-engine-http@1.0.0-beta.8
```

| Package path                        | Role                             |
| ----------------------------------- | -------------------------------- |
| `@mit-sdg/sync-engine-http/server`  | HTTP policy and Fetch handler    |
| `@mit-sdg/sync-engine-http/client`  | Typed Fetch client and transport |
| `@mit-sdg/sync-engine-http/tooling` | Generated HTTP wire projection   |

## `server`

<!-- register:http-server:start -->

`HttpCookieIssue`, `HttpCookiePolicy`, `HttpCorrelationOptions`, `HttpPolicy`, `HttpPublicErrorCategory`, `createHttpHandler`, `httpPolicy`

<!-- register:http-server:end -->

```ts
httpPolicy(declaration: HttpPolicy): HttpPolicy

createHttpHandler(options: {
  application: Assembly<Record<string, new (...args: never[]) => object>>;
  gateway: Gateway<ContractShape>;
  policy: HttpPolicy;
  correlation?: HttpCorrelationOptions;
}): (request: Request) => Promise<Response>
```

### `HttpPolicy`

```ts
interface HttpPolicy {
  readonly origin: string;
  readonly basePath?: string;
  readonly publicErrors?: Readonly<Record<string, HttpPublicErrorCategory>>;
  readonly cookie?: HttpCookiePolicy;
}
```

`httpPolicy(...)` validates, normalizes, snapshots, and freezes a policy. A
handler and wire projector also call `httpPolicy(...)`, so passing a raw mutable
object is supported but later mutation does not change the constructed handler
or projection.

#### `origin`

`origin` is required. It must contain only one absolute `http:` or `https:`
origin, with no path, query, fragment, credentials, or noncanonical spelling. A
single trailing slash is accepted and removed. When `NODE_ENV` is
`"production"`, the origin must use HTTPS.

For a plain policy without `cookie`, `origin` does not authorize requests and
the handler does not inspect the inbound `Origin` header. With a cookie policy,
`origin` supplies the default allowed Origin and determines cookie security and
prefix behavior.

`origin` does not configure CORS. The handler does not answer preflight requests
or emit CORS headers.

#### `basePath`

`basePath` is optional. `undefined`, the empty string, and `/` mean no prefix.
Otherwise the value must be a portable absolute route pathname. Trailing slashes
are removed. Queries, fragments, dot-segment normalization, encoded dot
segments, malformed escapes, backslashes, literal spaces or Unicode, and
scheme-relative paths are rejected by the core portable route-path contract.

The handler removes the base path before invoking the logical endpoint. A
request outside the configured base returns `NOT_FOUND`/404.

#### `publicErrors`

`publicErrors` maps nonempty domain refusal codes to one of:

| `HttpPublicErrorCategory` | Status |
| ------------------------- | ------ |
| `INVALID_REQUEST`         | 400    |
| `UNAUTHORIZED`            | 401    |
| `FORBIDDEN`               | 403    |
| `NOT_FOUND`               | 404    |
| `CONFLICT`                | 409    |

The map is an allowlist. An unmapped, inherited, malformed, non-string, or
unknown domain error becomes `INTERNAL_ERROR`/500. Framework `INVALID_INPUT`
becomes `INVALID_REQUEST`/400 and framework `NOT_FOUND` becomes
`NOT_FOUND`/404. Other framework failures become `INTERNAL_ERROR`/500. Public
failure bodies contain only `{ error }`; domain values, exception messages, and
stacks are not returned.

### `HttpCookiePolicy`

```ts
interface HttpCookieIssue {
  readonly path: string;
  readonly value: string;
  readonly expires: string;
}

interface HttpCookiePolicy {
  readonly name: string;
  readonly input: string;
  readonly issue: HttpCookieIssue | readonly HttpCookieIssue[];
  readonly clear?: readonly string[];
  readonly sameSite?: "Strict" | "Lax" | "None";
  readonly path?: string;
  readonly domain?: string;
  readonly origins?: readonly string[] | false;
}
```

A cookie policy binds one logical endpoint input to one cookie. Endpoint
declarations still define credential meaning, issuance, expiry, and revocation.

#### Logical name and protected input

`name` is a logical cookie name of 1 through 64 characters. It must begin with
an ASCII letter, digit, or underscore; remaining characters may also contain
dot and hyphen. Names beginning `__Host-` or `__Secure-` are rejected because
the handler selects the physical prefix.

`input` must be a JavaScript-style identifier. An endpoint is protected when its
input contract lists this field as required. At least one endpoint must be
protected.

For a protected endpoint, the request JSON must be a plain object. The handler
overwrites any body-supplied protected field with the decoded cookie value or
`null` when the cookie is absent or malformed. The body cannot override the
cookie credential. The projected HTTP wire omits the protected field from every
protected endpoint input.

#### Issue routes

`issue` accepts one `HttpCookieIssue` or a nonempty array. Each `path` must be a
distinct portable logical endpoint path. `value` and `expires` must be distinct
JavaScript-style field names. At handler construction and wire projection, each
path must exist and every top-level alternative of the endpoint output must
contain both fields.

After a successful issue invocation:

1. `value` must contain a nonempty string.
2. `expires` must be a valid `Date` or a value whose string conversion produces
   a valid future date.
3. Percent-encoding and all attributes must produce a `Set-Cookie` value no
   longer than 4,096 characters.
4. The handler removes the configured value and expiry properties from the JSON
   response, sets the cookie, and adds `Cache-Control: no-store`.

Each issue route may use different value and expiry names. An invalid issue
value, expiry, or serialized cookie returns `INTERNAL_ERROR`/500 with
`Cache-Control: no-store` and no `Set-Cookie` header.

The projected HTTP wire removes each issue route's own value and expiry fields
from all top-level output alternatives.

#### Clear routes

`clear` defaults to an empty array. Paths must be distinct portable logical
endpoint paths, must exist in the application, and cannot overlap an issue path.
A successful configured clear route returns its public JSON value, clears the
cookie with an epoch `Expires` and `Max-Age=0`, and adds
`Cache-Control: no-store`.

An `UNAUTHORIZED` result from any protected endpoint also clears the cookie and
uses `Cache-Control: no-store`, whether or not the endpoint is listed in
`clear`. Other public failures do not implicitly clear it.

#### Origin enforcement

`origins` defaults to a frozen one-element array containing `HttpPolicy.origin`.
An explicit array must be nonempty and contain distinct canonical absolute HTTP
or HTTPS origins.

Unless `origins` is `false`, every request handled by a cookie-policy handler
must contain a present `Origin` header exactly equal to one allowed value. A
missing or mismatched Origin returns `FORBIDDEN`/403. This check runs before
method, media-type, route, and body processing. It applies to issue, protected,
clear, and other routes handled by that handler. The handler does not compare
Origin with `request.url`.

`origins: false` disables this check. It is a lower-level opt-out for a host that
supplies an equivalent control. It does not enable or configure CORS.

#### Cookie attributes and prefixes

Defaults are `SameSite=Strict`, `Path=/`, no `Domain`, and `HttpOnly`. An HTTPS
origin adds `Secure`.

With HTTPS, no domain, and `Path=/`, the handler prefixes the logical name with
`__Host-`. With HTTPS and either a domain or another path, it uses `__Secure-`.
For an HTTP origin outside production, it adds neither prefix nor `Secure`.

`sameSite` accepts only `Strict`, `Lax`, or `None`; `None` requires an HTTPS
policy origin. `path` must be a portable absolute path and cannot contain
control, non-ASCII, or semicolon characters unsafe in a cookie attribute.
`domain`, when present, must be a canonical DNS hostname without a leading dot
and must be the policy origin hostname or one of its parent DNS hostnames. The
normalized policy stores the domain in lowercase.

Issuance uses the endpoint's absolute expiry and no `Max-Age`. Clearing uses the
epoch expiry and `Max-Age=0`.

### `createHttpHandler`

`createHttpHandler(...)` binds the supplied assembly and gateway, snapshots the
policy, validates cookie routes against the assembly, and returns a Fetch
handler. It throws if the gateway targets another application or policy
validation fails.

#### Request handling

After any cookie Origin check, the handler applies these rules in order:

1. The method must be `POST`; otherwise the response is
   `INVALID_REQUEST`/400.
2. A missing `Content-Type` is accepted. A present value must be
   `application/json`, case-insensitively, with optional parameters.
3. `URL.pathname` must be inside `basePath`; the remaining pathname selects the
   logical route. Query parameters do not select another route.
4. The body is read as UTF-8 with a limit of 1,048,576 bytes. A declared larger
   `Content-Length`, streamed overflow, or read failure returns
   `INVALID_REQUEST`/400. An oversized stream is canceled where possible.
5. An empty body becomes `{}`. A nonempty body must parse as JSON.
6. For a protected route, cookie input is injected as described above.
7. The handler invokes the bound gateway with the logical path, parsed value,
   request signal, and effective correlation ID.

A gateway timeout or request abort can stop waiting but does not roll back or
cancel accepted concept work.

#### Responses

Responses use `Content-Type: application/json`. Successful invocations use
status 200. Values follow the core JSON projection: `Date` values become strings
and `undefined` object fields disappear. A serialization failure, invoker throw,
or unhandled adapter failure becomes opaque `INTERNAL_ERROR`/500.

Cookie issue and clear processing occurs only after a successful invocation.
Public error projection follows `publicErrors` and the fixed framework mapping
above.

Handler calls may overlap. The handler does not serialize requests globally and
has no disposal method. It does not own or close the application, gateway,
concept stores, listener, Fetch runtime, or other host resources.

### Correlation

```ts
interface HttpCorrelationOptions {
  resolve(request: Request): string | undefined;
  responseHeader?: string;
}
```

When correlation options are present, `resolve(request)` runs synchronously once
for each request. An accepted ID is a nonempty ByteString of at most 128 UTF-16
code units, contains no control or DEL characters, and does not begin or end
with an ASCII space. Missing, invalid, or throwing resolver output is replaced
with `crypto.randomUUID()`.

The effective ID is passed to gateway and application observation.
`responseHeader`, when present, must be a valid header name. The handler adds the
ID only when the response does not already contain that header. A header
decoration failure does not replace the response.

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

`createHttpTransport` returns the HTTP transport for a generic core client.
`createHttpClient` composes that transport with `createClient` and forwards the
optional response validator.

### `HttpClientOptions`

| Field              | Default or effect                                                                      |
| ------------------ | -------------------------------------------------------------------------------------- |
| `baseUrl`          | `API_BASE_URL`, then `/api`; `/` selects the origin root; trailing slashes are removed |
| `fetch`            | `globalThis.fetch`                                                                     |
| `headers`          | Header record or synchronous/asynchronous provider called once per request             |
| `credentials`      | `"include"`                                                                            |
| `validateResponse` | Synchronous validation of the complete parsed result in `createHttpClient`             |
| `maxResponseBytes` | No cap; otherwise a positive finite integer byte limit                                 |

The client resolves `baseUrl`, including `API_BASE_URL`, when constructed. Later
environment changes do not alter it. A blank explicit base URL falls back in the
same way as omission.

The transport sends `POST` with `JSON.stringify(input ?? {})`. It starts with
`Content-Type: application/json`, then merges configured headers; configured
headers can replace that value. A request serialization throw or Fetch failure
before a response resolves as `NETWORK_ERROR`.

`HttpRequestContext` gives a header provider the logical `path`, effective
`signal`, and supplied `timeoutMs` and `correlationId`. The transport does not
create a correlation header. A provider must map the ID to a header explicitly.
A provider throw or rejection resolves as `HEADER_RESOLUTION_FAILED`.

### Response handling

An empty response body becomes `{}`. A nonempty body must parse as JSON;
response `Content-Type` is not consulted. A non-2xx JSON object with an `error`
property is returned as the server result. A non-2xx response without that
envelope resolves as `BAD_STATUS`.

| `HttpClientErrorCode`      | Condition                                                            |
| -------------------------- | -------------------------------------------------------------------- |
| `HEADER_RESOLUTION_FAILED` | Header provider threw or rejected                                    |
| `NETWORK_ERROR`            | Request serialization or Fetch failed before a response was obtained |
| `BAD_JSON`                 | Response body could not be read or parsed as JSON                    |
| `BAD_STATUS`               | Non-2xx response lacked a JSON error envelope                        |
| `RESPONSE_TOO_LARGE`       | Declared or streamed response exceeded `maxResponseBytes`            |

`maxResponseBytes` is validated at construction. When configured, the transport
rejects an oversized declared `Content-Length` before buffering and counts
streamed bytes when reading. Overflow cancels the body where possible without
waiting for cancellation.

### Abort and timeout

Caller abort resolves as core `ABORTED`. `timeoutMs` is local to the HTTP
transport and covers header resolution, Fetch, and response-body reading. It
must be a positive finite integer no greater than `2_147_483_647`; an invalid
value resolves as core `INVALID_INPUT` before header resolution or Fetch.
Expiry resolves as core `TIMED_OUT`.

Abort and timeout stop local waiting. They cannot cancel a pending header
provider and do not establish cancellation or rollback of accepted server work.
The transport attempts to cancel late or unread response bodies where possible.

### Response validation and concurrency

`createHttpClient` passes `validateResponse` to the core client. The callback
checks the complete parsed success-or-error result synchronously. A negative
validation result, a throw, or a promise-like result resolves as core
`TRANSPORT_ERROR`. An accepted value is not transformed. No validator is
inferred from a generated contract.

`createHttpTransport` does not apply `validateResponse` by itself. Pass the
validator to a surrounding core `createClient` when using the transport
directly.

Header providers and Fetch calls for concurrent client calls may overlap. The
client and transport have no disposal method and do not own the Fetch
implementation or agent. Browsers manage cookies. A Node.js or custom Fetch
implementation must supply cookie storage when later calls depend on an issued
cookie.

## `tooling`

<!-- register:http-tooling:start -->

`HttpWireOptions`, `httpWire`

<!-- register:http-tooling:end -->

```ts
httpWire(options: {
  readonly policy: HttpPolicy;
  readonly name: string;
}): WireProjection
```

`httpWire` snapshots the supplied policy when constructed. Use the same
`HttpPolicy` value for `createHttpHandler({ policy })` and
`httpWire({ policy, name })` so runtime and generated transport contracts have
the same public errors, protected inputs, and issue outputs. `basePath` remains
a handler/client deployment prefix; projected endpoint keys remain logical
paths.

The projection maps known endpoint and application-wide domain failures through
`publicErrors`. Unmapped failures become `INTERNAL_ERROR`. An open endpoint
domain-error branch also contributes `INTERNAL_ERROR`. Projected endpoint error
sets contain public HTTP categories rather than private refusal codes.

With a cookie policy, projection validates route existence, protected input use,
and issue outputs against the supplied wire facts. It omits the cookie input
from every protected endpoint and each issue route's configured value and
expiry fields from that route's output. A policy or projection validation error
occurs before generated artifact comparison or writing.

## Host responsibilities

The package does not supply a listener, TLS termination, HSTS, CORS, preflight
handling, trusted-proxy configuration, connection limits, request-rate limits,
denial-of-service controls, retries, idempotency, authentication policy, resource
authorization, session persistence, startup, drain, shutdown, or process
supervision. Those controls remain with the host and application.

Core [execution semantics](../../docs/user/reference/semantics.md#boundary-gateway-and-client)
define gateway settlement and accepted-work cancellation. [Operational
limits](../../docs/user/reference/operations.md#http-host-responsibilities)
define deployment responsibilities. The self-contained [Production HTTP
example](../../examples/production-http/README.md) exercises plain and cookie
policies with one generated HTTP contract.
