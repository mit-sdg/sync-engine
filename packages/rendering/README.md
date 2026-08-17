# @mit-sdg/sync-engine-rendering

`@mit-sdg/sync-engine-rendering` declares portable renderers for sync-engine application boundaries. A renderer is callable; calling it returns inert invocation data that an endpoint can pass directly to `respond(...)`.

```ts
import { html, renderer } from "@mit-sdg/sync-engine-rendering/language";

export const Heading = renderer("Shows the greeting heading.", () => html`<h1>Hello, world.</h1>`);

export const Hello = renderer("Composes the greeting.", () => html`<main>${Heading({})}</main>`);

const invocation = Hello({});
```

The tagged template records inert authored HTML and checked statements; it does
not execute interpolated JavaScript or perform DOM work. A renderer invocation
may occupy a subtree place as one named child. Later statement forms add shows,
rows, fields, and asks to the same language rather than creating a callback
template system.

Assembly installs each canonical interface-export identity before an endpoint
invokes the renderer. The invocation keeps the lowered declaration under
`$renderer` and its exact caller inputs at the mapping's top level. Rendering
validates the complete canonical renderer tree and may fuse its named subtrees
into one transport-neutral formed fragment.

## Public path

| Package path                              | Purpose                                                |
| ----------------------------------------- | ------------------------------------------------------ |
| `@mit-sdg/sync-engine-rendering/language` | Renderer declarations, invocations, and portable nodes |

The package has no root export and no supported deep imports. Its exact API is listed in [public-surface.md](public-surface.md).
