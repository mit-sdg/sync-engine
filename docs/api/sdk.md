# SDK API

Define and enforce typed application boundaries, then expose those boundaries
through local invocation, HTTP, or a human CLI. The SDK is imported from a single
entrypoint:

```ts
import {
  createEndpointDsl,
  createInvoker,
  createLocalClient,
  createHttpClient,
  createHttpHandler,
  createCliApp,
  InvocationResult,
  FrameworkErrorCode,
  // ...and more
} from "@mit-sdg/sync-engine/sdk";
```

## Core Model

The shared abstraction is a typed **endpoint invocation**. An endpoint is defined
once; its contract (input, output, domain-error types) feeds every boundary —
local, HTTP server, HTTP client, and human CLI.

```
endpoint contract + endpoint syncs
                |
           SDK invoker
        /          |          \
   local call   HTTP handler   human CLI
                    |
               HTTP client
```

## InvocationResult

Every boundary invocation uses one unambiguous result shape:

```ts
type InvocationResult<Output, DomainError> =
  | { ok: true; value: Output }
  | {
      ok: false;
      error:
        | { kind: "domain"; value: DomainError }
        | { kind: "framework"; code: FrameworkErrorCode; detail?: string };
    };
```

Construct results with `success()`, `domainError()`, and `frameworkError()`:

```ts
import { success, domainError, frameworkError, FrameworkErrorCode } from "@mit-sdg/sync-engine/sdk";

success({ token: "abc" });
// { ok: true, value: { token: "abc" } }

domainError({ code: "INVALID", detail: "bad input" });
// { ok: false, error: { kind: "domain", value: { code: "INVALID", detail: "bad input" } } }

frameworkError(FrameworkErrorCode.TIMED_OUT);
// { ok: false, error: { kind: "framework", code: "TIMED_OUT" } }
```

## FrameworkErrorCode

```ts
import { FrameworkErrorCode } from "@mit-sdg/sync-engine/sdk";
```

SDK-owned error codes emitted by the invoker, transports, and handlers:

| Code                       | Description                                       |
| -------------------------- | ------------------------------------------------- |
| `INVALID_INPUT`            | Request input failed schema validation            |
| `INVALID_OUTPUT`           | Response output failed schema validation          |
| `NOT_FOUND`                | No endpoint registered for the given path         |
| `TIMED_OUT`                | Request exceeded timeout or was aborted           |
| `MULTIPLE_RESPONSES`       | Endpoint responded more than once                 |
| `TRANSPORT_ERROR`          | Transport-level failure (e.g. network, process)   |
| `BAD_STATUS`               | Non-2xx HTTP response without error envelope      |
| `BAD_RESPONSE`             | Response body could not be decoded                |
| `NETWORK_ERROR`            | HTTP fetch failed (HTTP transport)                |
| `BAD_JSON`                 | Response body was not valid JSON (HTTP transport) |
| `HEADER_RESOLUTION_FAILED` | Header function threw (HTTP transport)            |

Engine-owned errors (e.g. `UNKNOWN_ERROR`) are exported from `@mit-sdg/sync-engine/engine`.

---

## Endpoint DSL

Define typed endpoint contracts from sync-engine syncs. The DSL builds on a
request-boundary concept (any concept with `request`/`respond` actions).

### createEndpointDsl(boundary) → { endpoint, syncMap }

Returns an `endpoint()` builder and `syncMap()` flattener.

```ts
import { createEndpointDsl } from "@mit-sdg/sync-engine/sdk";
import { RequestBoundaryConcept } from "@mit-sdg/sync-engine/sdk";
import { SyncConcept } from "@mit-sdg/sync-engine/engine";

const sync = new SyncConcept();
const boundary = new RequestBoundaryConcept();
const instrumented = sync.instrumentConcept(boundary);
const { endpoint, syncMap } = createEndpointDsl(instrumented);

const api = {
  auth: {
    login: endpoint("/auth/login", ({ request, respond }) => ({
      Login: ({ email, password }: Vars) =>
        request({ email, password }).then(respond({ token: "ok" })),
    })),
  },
};
```

The `endpoint()` builder provides three helpers:

- **`request(input?)`** — returns a `WhenBuilder` that matches `boundary.request`
  with `path` and an implicit `requestId` for request-response correlation.
- **`respond(body?)`** — dispatches `boundary.respond` with the body and
  `requestId`.
- **`fail(error?)`** — dispatches `boundary.respond` with an `error` key and
  `requestId`. The invoker detects the `error` key as a domain error.

### syncMap(api) → Record<string, Sync>

Flatten a nested tree of endpoint definitions into a flat record of sync
functions. Dotted paths become dotted names (`auth.login`).

```ts
const allSyncs = syncMap(api);
sync.register(allSyncs);
```

### ContractOf<T>

Extracts the full contract type from an endpoint definition tree — the
intersection of all `{ [path]: { input, output, error } }` triples.

```ts
type MyApi = ContractOf<typeof api>;
// { "/auth/login": { input: { email; password }, output: { token }, error: { code } }, ... }
```

### unchecked<T>() — unsafe schema placeholder

Returns a `TypedSchema` that accepts any value while carrying `T` statically.
For incremental adoption of runtime validation:

```ts
import { unchecked } from "@mit-sdg/sync-engine/sdk";

const schema = unchecked<{ email: string; password: string }>();
// Passes validation for any input; carries the type for later replacement.
```

---

## Invoker

The transport-neutral center of the SDK. The invoker performs the complete
application-boundary lifecycle: endpoint lookup, input validation, request
correlation, execution, output validation, timeouts, and cancellation.

### createInvoker(options) → Invoker

Creates an invoker wrapping a `RequestBoundaryConcept` and its instrumented
actions. The invoker returns `InvocationResult` for every call, so success,
domain errors, and framework errors are always distinguishable.

```ts
import { createInvoker, RequestBoundaryConcept } from "@mit-sdg/sync-engine/sdk";

const sync = new SyncConcept();
const boundary = new RequestBoundaryConcept();
const instrumented = sync.instrumentConcept(boundary);
const dsl = createEndpointDsl(instrumented);

// ... define endpoints, register syncs ...

const invoker = createInvoker({ boundary, instrumented });

const result = await invoker.invoke("/auth/login", {
  email: "user@example.com",
  password: "secret",
});
// result: InvocationResult<{ token: string }, { code: string }>

if (result.ok) {
  console.log("token:", result.value.token);
} else if (result.error.kind === "domain") {
  console.error("login failed:", result.error.value);
} else {
  console.error("framework error:", result.error.code);
}
```

### Invoker<C>

```ts
interface Invoker<C extends ContractShape> {
  invoke<P extends keyof C & string>(
    path: P,
    input: C[P]["input"],
    options?: { signal?: AbortSignal; timeoutMs?: number },
  ): Promise<InvocationResult<C[P]["output"], C[P]["error"]>>;
}
```

| Option      | Default  | Description                                     |
| ----------- | -------- | ----------------------------------------------- |
| `signal`    | —        | `AbortSignal` to cancel the request             |
| `timeoutMs` | `30_000` | Max time in milliseconds to wait for a response |

### createLocalClient(options) → Client

Typed proxy facade over an invoker. Supports both grouped and indexed calling
styles (same as `createClient`).

```ts
const local = createLocalClient<AppApi>({ invoker });

// grouped style
const result = await local.auth.login({ email, password });

// indexed style
const result = await local["/auth/login"]({ email, password });
```

---

## Client (Transport-Agnostic)

Typed, proxy-based client. Transport-agnostic. Supports two calling styles.

```ts
import { createClient } from "@mit-sdg/sync-engine/sdk";

const client = createClient<MyApi>({ transport });

// grouped style
const result = await client.auth.login({ email, password });

// indexed style
const result = await client["/auth/login"]({ email, password });
```

### createClient<C>(options) → Client<C>

| Option      | Type              | Description                                      |
| ----------- | ----------------- | ------------------------------------------------ |
| `transport` | `ClientTransport` | Function `({ path, input }) => Promise<unknown>` |

Errors thrown by the transport are caught and returned as
`{ error: FrameworkErrorCode.TRANSPORT_ERROR, detail }`.

### ClientTransport

```ts
type ClientTransport<TError = ClientError> = (request: {
  path: string;
  input: unknown;
}) => Promise<unknown | TError>;
```

### ClientError

```ts
type ClientError = { error: string; detail?: string };
```

---

## HTTP

### HTTP Client

```ts
import { createHttpClient, createHttpTransport } from "@mit-sdg/sync-engine/sdk";
```

#### createHttpClient<C>(options?) → Client<C>

Convenience: composes `createHttpTransport` with `createClient`.

```ts
const client = createHttpClient<MyApi>({
  baseUrl: "https://api.example.com/v1",
  headers: () => ({ Authorization: `Bearer ${getToken()}` }),
});
```

#### createHttpTransport(options?) → ClientTransport

Creates a `fetch`-based transport for use with `createClient`.

Every request is a `POST` with `Content-Type: application/json`. The input is
JSON-stringified as the request body (`{}` when the input is absent). Credentials
default to `"include"`.

| Option        | Default                         | Description                                          |
| ------------- | ------------------------------- | ---------------------------------------------------- |
| `baseUrl`     | `API_BASE_URL` env, then `/api` | Prefix for every request path                        |
| `fetch`       | `globalThis.fetch`              | Custom fetch implementation                          |
| `headers`     | —                               | Static record or function producing headers per call |
| `credentials` | `"include"`                     | Request credentials mode                             |

### HTTP Handler (Server-Side)

Maps incoming HTTP `Request` objects to invoker calls and produces standard
`Response` objects. Framework-agnostic — use with any HTTP server that produces
`Request`/`Response`.

```ts
import { createHttpHandler } from "@mit-sdg/sync-engine/sdk";

const handler = createHttpHandler({ invoker, basePath: "/api" });

// In a Bun/Deno server:
const response = await handler(request);
// In Node with a compatible adapter, or with fetch-based server runtimes.
```

#### createHttpHandler(options) → (request: Request) => Promise<Response>

| Option     | Default    | Description                                  |
| ---------- | ---------- | -------------------------------------------- |
| `invoker`  | (required) | The `Invoker` to dispatch requests through   |
| `basePath` | `""`       | Stripped from the URL pathname before lookup |

The handler:

- Returns **405** for non-POST methods
- Returns **400** for invalid JSON request bodies
- Delegates to the invoker for endpoint lookup, validation, and execution
- Maps `InvocationResult` back to HTTP:
  - Success (`ok: true`) → **200** with JSON body
  - Domain error → **400** with JSON body
  - Framework error → status code mapped by error code (404, 422, 500, 504)

---

## CLI App

Build a typed command-line app. Commands are defined by name with arg parsers
and async `run` functions. The CLI can optionally use an invoker for dispatch
via typed endpoint commands.

```ts
import { createCliApp, command, ok, fail, parseArgs } from "@mit-sdg/sync-engine/sdk";
```

### createCliApp(commands, options?) → CliApp

```ts
const app = createCliApp(
  {
    add: {
      description: "Add a work item",
      parse: (positionals, options) => {
        if (positionals.length === 0) return fail("title required");
        return { title: positionals.join(" "), priority: String(options.priority ?? "normal") };
      },
      run: async ({ title, priority }) => {
        const result = await Work.add({ title, priority });
        if ("error" in result) return fail(result.detail);
        return ok(`Added ${result.item}`);
      },
    },
  },
  { name: "stitch" },
);

// Traditional CLI (process.argv):
const result = await app.run(["add", "buy milk", "--priority", "high"]);
// result = { stdout: "Added W001\n", stderr: "", exitCode: 0 }

// Typed dispatch (programmatic):
const result = await app.dispatch("add", { title: "buy milk", priority: "high" });
```

| Option    | Type      | Description                                 |
| --------- | --------- | ------------------------------------------- |
| `name`    | `string`  | App name shown in auto-generated help       |
| `version` | `string`  | Version shown in help                       |
| `invoker` | `Invoker` | Optional; enables endpoint-command dispatch |

### command(endpointRef, options) → EndpointCliCommand

Creates a command backed by an endpoint, invoked through the invoker:

```ts
const app = createCliApp(
  {
    add: command(api.work.add, {
      description: "Add a work item",
      parse: (args, opts) => parseOk({ title: args.join(" "), priority: "normal" }),
      format: (result) => (result.ok ? ok(`Added ${result.value.title}`) : fail("Failed to add")),
    }),
  },
  { invoker, name: "stitch" },
);
```

### ParseResult<T> / parseOk / parseFail

Typed parser outcomes for `command()`:

```ts
import { parseOk, parseFail } from "@mit-sdg/sync-engine/sdk";

type ParseResult<T> = { ok: true; value: T } | { ok: false; message: string };

parseOk({ title: "hello" }); // success
parseFail("title required"); // failure
```

### CliApp commands

| Method                  | Description                                                                  |
| ----------------------- | ---------------------------------------------------------------------------- |
| `run(args: string[])`   | Dispatch from raw CLI args. First arg = command name.                        |
| `dispatch(name, input)` | Typed dispatch. `input` is compile-time checked against `parse` return type. |
| `help()`                | Auto-generated help text from command descriptions.                          |

### CliResult / ok / fail / parseArgs

```ts
interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function ok(stdout: string): CliResult; // exitCode 0, appends newline
function fail(stderr: string): CliResult; // exitCode 1, appends newline

function parseArgs(args: string[]): ParsedArgs;
// ParsedArgs = { positionals: string[]; options: Record<string, string | boolean> }
// --flag           → options.flag = true
// --key value      → options.key = "value"
// --key=value      → options.key = "value"
// Everything else  → positionals
```
