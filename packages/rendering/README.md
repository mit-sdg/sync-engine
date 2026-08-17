# @mit-sdg/sync-engine-rendering

`@mit-sdg/sync-engine-rendering` declares portable renderers for sync-engine application boundaries. A renderer is callable; calling it returns inert invocation data that an endpoint can pass directly to `respond(...)`.

```ts
import { html, renderer } from "@mit-sdg/sync-engine-rendering/language";

export const Hello = renderer("Hello", html`<main>Hello, world.</main>`);

const invocation = Hello({});
```

The tagged template records inert authored HTML; the rendering package does not parse it or perform DOM work. The invocation keeps the declaration under `$renderer` and caller inputs at the mapping's top level. An interface companion decides how to interpret the declaration.

## Public path

| Package path                              | Purpose                                                |
| ----------------------------------------- | ------------------------------------------------------ |
| `@mit-sdg/sync-engine-rendering/language` | Renderer declarations, invocations, and portable nodes |

The package has no root export and no supported deep imports. Its exact API is listed in [public-surface.md](public-surface.md).
