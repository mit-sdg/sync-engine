# sync-engine

A small TypeScript library for joining independent pieces of an application
without making them call each other.

Read the full guide at [`docs/README.md`](docs/README.md).

## Install

```bash
bun add @mit-sdg/sync-engine
# or: npm install @mit-sdg/sync-engine
```

## Quick start

```ts
import { Logging, SyncConcept } from "@mit-sdg/sync-engine/engine";

const engine = new SyncConcept();
engine.logging = Logging.TRACE;

const { Todo, Audit } = engine.instrument({
  Todo: new TodoConcept(),
  Audit: new AuditConcept(),
});

engine.register(makeSyncs(Todo, Audit));

await Todo.add({ id: "T1", title: "Learn sync-engine" });
await Todo.complete({ id: "T1" });
```

## Modules

| Path                           | Purpose                                     |
| ------------------------------ | ------------------------------------------- |
| `@mit-sdg/sync-engine/engine`  | Journal, matching, frames, and the sync DSL |
| `@mit-sdg/sync-engine/sdk`     | Endpoint contracts and HTTP/CLI clients     |
| `@mit-sdg/sync-engine/runtime` | Hosting and lifecycle helpers               |
| `@mit-sdg/sync-engine/utils`   | Cache, logging, and redaction               |

## Documentation

- [Full guide](docs/README.md)
- [Engine API](docs/api/engine.md)
- [SDK API](docs/api/sdk.md)
- [Runtime API](docs/api/runtime.md)
- [Utils API](docs/api/utils.md)

## License

[Apache 2.0](LICENSE)
