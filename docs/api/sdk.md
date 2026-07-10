# SDK API

Typed endpoint DSL and transport-agnostic client. No code generation.

```ts
import { createEndpointDsl, createHttpClient, createCliClient } from "@mit-sdg/sync-engine/sdk";
```

---

## Endpoint DSL

Define typed endpoint contracts from sync-engine syncs. The DSL builds on a request-boundary concept (any concept with `request`/`respond` actions).

### createEndpointDsl(boundary) → { endpoint, syncMap }

Returns an `endpoint()` builder and `syncMap()` flattener.

```ts
const { endpoint, syncMap } = createEndpointDsl(Requesting);

const api = {
  auth: {
    login: endpoint<
      "/auth/login",
      {
        input: { email: string; password: string };
        output: { token: string };
        error: { error: string };
      }
    >("/auth/login", ({ request, respond }) => ({
      OnLoginRequest: sync(({ email, password }) =>
        request({ email, password })
          .then(act(Auth.authenticate, { email, password }, { token }))
          .then(respond({ token })),
      ),
    })),
  },
};
```

The `endpoint()` builder:

- **`request(input?)`** — returns a `WhenBuilder` that matches `boundary.request` with a `path` field set to the endpoint path
- **`respond(body?)`** — dispatches `boundary.respond` with the given body (plus `request` id)
- **`fail(error?)`** — dispatches `boundary.respond` with error fields

Each endpoint's `path` becomes part of the typed contract. The second generic parameter (`TContract`) declares the endpoint's input/output/error shapes for client-side inference.

### syncMap(api) → Record\<string, Sync\>

Flatten a nested tree of endpoint definitions into a flat record of sync functions. Dotted paths become dotted names (`auth.login`).

```ts
const allSyncs = syncMap(api);
engine.register(allSyncs);
```

### ContractOf\<T\>

Extracts the full contract type from an endpoint definition tree — the intersection of all `{ [path]: { input, output, error } }` triples.

```ts
type MyApi = ContractOf<typeof api>;
// { "/auth/login": { input: { email; password }, output: { token }, error: { error } }, ... }
```

---

## Client

Typed, proxy-based client. Transport-agnostic. Supports two calling styles.

```ts
import { createClient } from "@mit-sdg/sync-engine/sdk";

const client = createClient<MyApi>({ transport });

// grouped style
const result = await client.auth.login({ email, password });

// indexed style
const result = await client["/auth/login"]({ email, password });
```

When the contract declares an empty input (`Record<string, never>`), the parameter is optional:

```ts
await client.health.ping(); // no argument needed
```

### createClient\<C\>(options) → Client\<C\>

| Option      | Type              | Description                                      |
| ----------- | ----------------- | ------------------------------------------------ |
| `transport` | `ClientTransport` | Function `({ path, input }) => Promise<unknown>` |

Errors thrown by the transport are caught and returned as `{ error: "TRANSPORT_ERROR", detail }`.

### Client\<C\>

Combined type: `IndexedClient<C> & GroupedClient<C>`. Both styles are fully inferred from the contract.

### ClientTransport

```ts
type ClientTransport<TError = ClientError> = (request: {
  path: string;
  input: unknown;
}) => Promise<unknown | TError>;
```

### ClientError

Normalized error envelope for transport-level failures:

```ts
type ClientError = { error: string; detail?: string };
```

---

## HTTP Client

```ts
import { createHttpClient, createHttpTransport } from "@mit-sdg/sync-engine/sdk/http-client";
```

### createHttpClient\<C\>(options?) → Client\<C\>

Convenience: composes `createHttpTransport` with `createClient`.

```ts
const client = createHttpClient<MyApi>({
  baseUrl: "https://api.example.com/v1",
  headers: () => ({ Authorization: `Bearer ${getToken()}` }),
});
```

### createHttpTransport(options?) → ClientTransport

Creates a `fetch`-based transport for use with `createClient`.

```ts
const transport = createHttpTransport({ baseUrl: "http://localhost:3000/api" });
const client = createClient<MyApi>({ transport });
```

| Option        | Default                         | Description                                          |
| ------------- | ------------------------------- | ---------------------------------------------------- |
| `baseUrl`     | `API_BASE_URL` env, then `/api` | Prefix for every request path                        |
| `fetch`       | `globalThis.fetch`              | Custom fetch implementation                          |
| `headers`     | —                               | Static record or function producing headers per call |
| `credentials` | `"include"`                     | Request credentials mode                             |

---

## CLI Client

Spawns a child process per request, writes JSON to stdin, reads JSON from stdout.

```ts
import { createCliClient, createCliTransport } from "@mit-sdg/sync-engine/sdk/cli-client";
```

### createCliClient\<C\>(options) → Client\<C\>

Convenience: composes `createCliTransport` with `createClient`.

```ts
const client = createCliClient<MyApi>({
  command: "node",
  args: ["dist/cli.js", "serve"],
  timeoutMs: 5000,
});
```

### createCliTransport(options) → ClientTransport

| Option      | Description                      |
| ----------- | -------------------------------- |
| `command`   | The command to spawn             |
| `args`      | Arguments passed to the command  |
| `cwd`       | Working directory                |
| `env`       | Extra environment variables      |
| `timeoutMs` | Max time to wait for the process |

### Protocol

The transport writes `{ "path": string, "input": unknown }` as one JSON line to stdin, then reads stdout as one JSON response object. Non-zero exit codes, timeouts, and parse failures are returned as `{ error, detail }` envelopes.

---

## FrameworkErrorCode

```ts
import { FrameworkErrorCode } from "@mit-sdg/sync-engine/sdk";
```

Framework-owned error codes (never domain rules). Values are part of the stable wire protocol.

**Server / Framework**: `BODY_TOO_LARGE`, `INTERNAL_ERROR`, `INVALID_BODY`, `NOT_FOUND`, `RATE_LIMITED`, `TIMED_OUT`, `UNKNOWN_APP`, `UNKNOWN_ERROR`, `UNSUPPORTED_MEDIA_TYPE`, `VALIDATION_FAILED`

**HTTP client**: `BAD_JSON`, `BAD_STATUS`, `HEADER_RESOLUTION_FAILED`, `NETWORK_ERROR`

**CLI client**: `COMMAND_FAILED`, `COMMAND_TIMED_OUT`, `PROCESS_ERROR`

---

## Key types

| Export                   | Description                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------------- |
| `Client<C>`              | Full typed client (indexed + grouped)                                                       |
| `ClientTransport`        | `(req: ClientRequest) => Promise<unknown>`                                                  |
| `ClientError`            | `{ error: string; detail?: string }`                                                        |
| `Endpoint`               | Terminal callable type for a single path                                                    |
| `ContractShape`          | `Record<string, { input; output; error? }>` — structural contract constraint                |
| `EndpointHelpers`        | `{ request(input?): WhenBuilder; respond(body?): ThenNode; fail(error?): ThenNode }`        |
| `EndpointContract`       | `{ input?; output?; error? }` — per-endpoint contract                                       |
| `ContractOf<T>`          | Extracts the contract type from an endpoint tree                                            |
| `HttpClientOptions`      | `{ baseUrl?, fetch?, headers?: HeadersOption, credentials? }`                               |
| `CliClientOptions`       | `{ command, args?, cwd?, env?, timeoutMs? }`                                                |
| `HeadersOption`          | `Record<string, string> \| () => Record<string, string> \| Promise<Record<string, string>>` |
| `RequestBoundaryActions` | `{ request: InstrumentedAction; respond: InstrumentedAction }`                              |
