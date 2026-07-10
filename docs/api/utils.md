# Utils API

Shared utilities used across the engine, SDK, and runtime.

```ts
import { cached, logger, redact, configureRedaction } from "@mit-sdg/sync-engine/utils";
```

---

## cached(fn, options?) → CachedFn\<T\>

LRU memoization with TTL and max-size eviction. Cache keys are derived from stable serialization of arguments (handles objects, arrays, symbols, functions, Date, Map, Set, BigInt).

```ts
import { cached } from "@mit-sdg/sync-engine/utils";

const expensive = cached(
  async (id: string) => {
    const row = await db.query("SELECT * FROM users WHERE id = ?", [id]);
    return row;
  },
  { maxSize: 500, ttlMs: 60_000 },
);

const user = await expensive("user-1");
// ...same call within 60s returns cached result

expensive.invalidate(); // clear all entries
expensive.size; // current entry count
```

| Option    | Default          | Description                     |
| --------- | ---------------- | ------------------------------- |
| `maxSize` | `1000`           | Max entries before LRU eviction |
| `ttlMs`   | `300000` (5 min) | Entry lifetime in milliseconds  |

A synchronous function is memoized directly. An async function is memoized
as a promise; the promise is cached immediately (preventing concurrent
duplicate calls). Once the promise settles successfully its TTL and LRU
recency are refreshed. Rejected promises are evicted.

---

## logger

Singleton structured logger. Controlled by environment variables.

```ts
import { logger } from "@mit-sdg/sync-engine/utils";

logger.debug("processing", { userId, batchSize });
logger.info("server started", { port: 3000 });
logger.warn("retry attempt", { attempt: 3 });
logger.error("unhandled rejection", { error: serializeError(err) });
```

### Request-scoped loggers

```ts
const log = logger.withRequestId(reqId);
log.info("request received"); // includes the requestId in each entry
```

### Configuration

- `LOG_LEVEL` env: `debug`, `info`, `warn`, `error`, `none` (default: `info`)
- `LOGGING_FORMAT` env: `json` (default) or `pretty`

### formatLogEntry(entry) → string

Format a log entry object into its configured output string.

### serializeError(err) → Record\<string, unknown\>

Convert an Error (with cause chain, up to depth 10) into a plain object with `name`, `message`, `stack`, and optional `cause`.

```ts
import { serializeError } from "@mit-sdg/sync-engine/utils";
logger.error("db failure", { error: serializeError(err) });
```

---

## Redaction

Recursive redaction for logging and journal sanitization. Universal credential patterns are always honored; register domain patterns at bootstrap.

### redact(obj) → unknown

Recursively redact sensitive fields (up to depth 5). Replaces matched values
with `"[redacted]"`. Also exported from `@mit-sdg/sync-engine/engine` as
`sanitize`.

```ts
redact({ password: "secret", name: "Alice" });
// { password: "[redacted]", name: "Alice" }
```

### configureRedaction(policy)

Register domain-specific fields and patterns. Call once at bootstrap.

```ts
configureRedaction({
  fields: ["ssn", "creditCard", "phoneNumber"],
  patterns: [/^govId$/i],
});
```

### UNIVERSAL_SENSITIVE_PATTERNS

Always-applied credential patterns: `password`, `secret`, `token`, `session`, `auth`, `api-key` / `api_key` (case-insensitive).

### RedactionPolicy

```ts
interface RedactionPolicy {
  fields?: Iterable<string>; // exact field names (case-insensitive)
  patterns?: readonly RegExp[]; // additional regex patterns
}
```

---

## Key types

| Export                   | Description                                                   |
| ------------------------ | ------------------------------------------------------------- |
| `CachedFn<T>`            | Memoized function with `.invalidate()` and `.size`            |
| `CacheOptions`           | `{ maxSize?: number; ttlMs?: number }`                        |
| `DEFAULT_CACHE_MAX_SIZE` | `1000`                                                        |
| `DEFAULT_CACHE_TTL_MS`   | `300000` (5 min)                                              |
| `Logger`                 | `{ debug, info, warn, error, withRequestId, requestId? }`     |
| `LogLevel`               | `"debug" \| "info" \| "warn" \| "error" \| "none"`            |
| `RedactionPolicy`        | `{ fields?: Iterable<string>; patterns?: readonly RegExp[] }` |
