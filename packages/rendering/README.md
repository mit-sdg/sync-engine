# @mit-sdg/sync-engine-rendering

`@mit-sdg/sync-engine-rendering` declares portable renderers for sync-engine application boundaries. A renderer is callable; calling it returns inert invocation data that an endpoint can pass directly to `respond(...)`.

```ts
import { html, renderer } from "@mit-sdg/sync-engine-rendering/language";

export const Heading = renderer("Shows the greeting heading.", () => html`<h1>Hello, world.</h1>`);

export const Hello = renderer(
  "Composes the greeting.",
  ({ audience }) =>
    html`<main>
      ${Heading({})}
      <p>${audience}</p>
    </main>`,
);

const invocation = Hello({ audience: "world" });
```

The tagged template records inert authored HTML and checked statements; it does
not execute interpolated JavaScript or perform DOM work. Inputs and values bound
by declared reads may occupy escaped text seats or checked attribute seats
(`title=${x}` value seats, `?disabled=${x}` presence seats); `each(...).html`
and `where(...).html` form query-backed subtrees; a renderer invocation may
occupy a subtree place as one named child; and fields, asks, and refusal seats
arm elements in the same language rather than creating a callback template
system.

Assembly installs each canonical interface-export identity before an endpoint
invokes the renderer. The invocation keeps the lowered declaration under
`$renderer` and its exact caller inputs at the mapping's top level. Rendering
validates the complete canonical renderer tree and may fuse its named subtrees
into one transport-neutral formed fragment.

Formation retains an addressed standing tree beneath that fragment. Authored
show and read positions supply structural addresses; a query's optional
`identified by (...)` promise extends those addresses through repeated rows.
`diffHtml(previous, next)` consequently emits exact show, clause, and ordered
row patches. A repeated query without an identity promise remains valid and
falls back to replacement of its one authored clause.

HTML has a sibling presentation family for machine participants. A `context`
renderer projects plain text — literal content, shows, query-backed blocks,
and named context children — plus registered asks interpolated in flow
position, and `compileContext` forms one root invocation into a deliberative
unit: readable text, a generic ask set answered by opaque identity and named
blanks, a read footprint, and addressed sources. The same declaration,
identity, scope, and row-identity semantics carry across both families;
provider roles, tool names, and wire schemas stay with the connected edge.

## Public path

| Package path                              | Purpose                                                |
| ----------------------------------------- | ------------------------------------------------------ |
| `@mit-sdg/sync-engine-rendering/language` | Renderer declarations, invocations, and portable nodes |
| `@mit-sdg/sync-engine-rendering/compiled` | Formation trees and semantic HTML patch derivation     |

The package has no root export and no supported deep imports. Its exact API is listed in [public-surface.md](public-surface.md).
