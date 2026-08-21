# HTTP and local clients

A frontend reaches the application only through its generated endpoint contract. For a
browser, construct:

```ts
import type { Client } from "@mit-sdg/sync-engine/client";
import { createHttpClient, type HttpClientError } from "@mit-sdg/sync-engine-http/client";
import type { AppWireHttp } from "../generated/wire.ts";

const client: Client<AppWireHttp, HttpClientError> = createHttpClient({ baseUrl: "/api" });
```

Endpoint groups follow the generated wire. Hyphenated names use indexed access. Every
result is a union: test `"error" in result` before reading success fields. Calls accept an
optional `{ signal, timeoutMs, correlationId }` argument.

For a command-line or in-process frontend, `createLocalClient<Wire>({ invoker: gateway })`
from `@mit-sdg/sync-engine/client` returns the same typed client over the same generated
contract without HTTP.
