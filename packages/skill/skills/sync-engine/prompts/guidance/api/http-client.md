# HTTP and local clients

A frontend reaches the application only through its generated endpoint contract. `baseUrl`
is the prefix where the HTTP handler is mounted. The host example passes the handler at the
origin root, so use `/`; use `/api` only when host code mounts the handler there.

```ts
import type { Client } from "@mit-sdg/sync-engine/client";
import { createHttpClient, type HttpClientError } from "@mit-sdg/sync-engine-http/client";
import type { AppWireHttp } from "../generated/wire.ts";

const client: Client<AppWireHttp, HttpClientError> = createHttpClient<AppWireHttp>({
  baseUrl: "/",
});

const result = await client.links.resolve({ code: "sample" });
if ("error" in result) {
  console.error(result.error);
} else {
  console.log(result.target);
}
```

Endpoint groups and methods follow path segments in the generated wire; `/links/resolve`
becomes `client.links.resolve(...)`. Hyphenated names use indexed access. Every result is a
union: test `"error" in result` before reading success fields. Calls accept an optional
`{ signal, timeoutMs, correlationId }` argument.

For a command-line or in-process frontend, `createLocalClient<Wire>({ invoker: gateway })`
from `@mit-sdg/sync-engine/client` returns the same typed client over the same generated
contract without HTTP.
