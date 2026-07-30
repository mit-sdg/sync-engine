# Public API

This reference lists every supported package subpath and export for
`@mit-sdg/sync-engine-http`. The package has no root export and no supported
deep import. The export registers are exact; compact signatures and tables
summarize the principal call shapes and do not replace the generated TypeScript
declarations.

The [core public API reference](https://github.com/mit-sdg/sync-engine/blob/main/docs/public-surface.md)
defines the supported core subpaths and transport-neutral contracts.

Install the maintained companion explicitly:

```sh
bun add @mit-sdg/sync-engine@latest @mit-sdg/sync-engine-http@latest
```

Pin both selectors to compatible versions for reproducibility. The independently
published companion declares a compatible stable core peer dependency. It is
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

`HttpPublicErrorCategory` is `INVALID_REQUEST`, `UNAUTHORIZED`, `FORBIDDEN`,
`NOT_FOUND`, or `CONFLICT`. Those categories use status 400, 401, 403, 404, and
409 respectively. Private and unknown domain refusals use `INTERNAL_ERROR`/500.
Framework `INVALID_INPUT` uses `INVALID_REQUEST`/400 and framework `NOT_FOUND`
uses `NOT_FOUND`/404; other framework server failures use
`INTERNAL_ERROR`/500. Public failure bodies contain only `{ error }`.

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
as required. The issue and clear paths must exist, at least one endpoint must be
protected, and every top-level issue-output alternative must contain the token
and expiry fields. `createHttpHandler(...)` checks these rules synchronously and
also rejects a gateway that does not target `application`. The floor checks the
declared origin only when an inbound `Origin` header is present; it is not a
CORS implementation.

`HttpCorrelationOptions.resolve(request)` is called synchronously for each
request. `responseHeader`, when supplied, must be a valid header name. Invalid,
missing, or faulting resolver results are replaced with a UUID under the rules
in [Correlation and route paths](https://github.com/mit-sdg/sync-engine/blob/main/docs/semantics.md#correlation-and-route-paths).

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

The transport sends JSON `POST` requests. Per-request headers are merged after
the initial `Content-Type: application/json` header and can replace it. An empty
response body becomes `{}`. A nonempty body must be JSON; response
`Content-Type` is not consulted. A non-2xx JSON object with an `error` property
is returned as the server result. A non-2xx response without that envelope uses
`BAD_STATUS`.

`HttpRequestContext` contains `path` and the call's effective `signal`,
`timeoutMs`, and `correlationId` when present. The package does not create a
correlation header; a header provider must project `correlationId` explicitly.
`timeoutMs` is local to the HTTP transport and aborts its Fetch wait when it
expires. An invalid timeout resolves as core `INVALID_INPUT`; an invalid
`maxResponseBytes` throws while constructing the client or transport.

| `HttpClientErrorCode`      | Condition                                             |
| -------------------------- | ----------------------------------------------------- |
| `HEADER_RESOLUTION_FAILED` | The per-request header provider threw or rejected     |
| `NETWORK_ERROR`            | Fetch failed before a response was obtained           |
| `BAD_JSON`                 | The response body could not be read or parsed as JSON |
| `BAD_STATUS`               | A non-2xx response lacked a JSON error envelope       |
| `RESPONSE_TOO_LARGE`       | Declared or streamed response bytes exceeded the cap  |

Abort is a core client condition and resolves as `ABORTED`, not as an
`HttpClientErrorCode`. Abort can settle while an asynchronous header provider is
still pending; the package cannot cancel that provider. An HTTP timeout or
abort stops local transport waiting but does not establish cancellation or
rollback of accepted server work. The handler passes its host-provided
`Request.signal` to the invoker, but the HTTP protocol adds no server-work
cancellation message.

`createHttpClient` forwards `validateResponse` to the core client, which checks
the complete parsed success-or-error result without transforming an accepted
value. A `{ ok: false }` result, throw, or asynchronous validator result resolves
as core `TRANSPORT_ERROR`; no validator is inferred from the generated contract.
`createHttpTransport` alone does not apply `validateResponse`; pass the validator
to the surrounding `createClient` instead. In Node.js, the selected `fetch`
implementation must provide cookie storage if a credential floor requires
browser-like cookie persistence.

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
and consumed issue outputs. A raw mutable policy is structurally accepted but is
read later when projection runs; mutating it can change generated output.

The package owns POST, JSON, body-size, origin, status, cookie, correlation, and
fetch behavior. See [Execution semantics](https://github.com/mit-sdg/sync-engine/blob/main/docs/semantics.md#boundary-gateway-and-client)
and the [production example](https://github.com/mit-sdg/sync-engine/tree/main/examples/production-http).
