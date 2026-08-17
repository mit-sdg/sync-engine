# Public API

`@mit-sdg/sync-engine-rendering` has no root export or supported deep imports.

## `@mit-sdg/sync-engine-rendering/compiled`

<!-- register:rendering-compiled:start -->

`CompiledHtmlRendering`, `FormedHtml`, `FormedHtmlContent`, `compileHtml`

<!-- register:rendering-compiled:end -->

`compileHtml(...)` checks the HTML renderer closure admitted by one bound
interface. The returned value forms endpoint-returned renderer invocations into
transport-neutral HTML fragments.

## `@mit-sdg/sync-engine-rendering/language`

<!-- register:rendering-language:start -->

`HtmlNode`, `Renderer`, `RendererBindings`, `RendererBuilder`, `RendererDeclaration`, `RendererInputs`, `RendererInvocation`, `RenderingNode`, `html`, `isRenderer`, `isRendererInvocation`, `renderer`

<!-- register:rendering-language:end -->

### `renderer`

```ts
renderer<Inputs extends RendererInputs = Record<string, never>>(
  description: string,
  build: RendererBuilder<Inputs>,
): Renderer<Inputs>
```

The exported binding in the assembled interface supplies renderer identity. The
description is human-readable IR metadata, and the builder closure receives
explicit binding bags. Calling an installed renderer produces an inert portable
`RendererInvocation` with caller inputs beside `$renderer`.
The input names read from the builder's first binding bag form the exact
runtime caller-input contract; invocation refuses missing or additional names.

### `html`

```ts
html(strings: TemplateStringsArray, ...statements: readonly unknown[]): HtmlNode
```

`html` records inert markup and checked authored statements as a portable HTML
node. A direct renderer invocation such as `${Heading({})}` places that named
renderer in a subtree position. Arbitrary computed values and callbacks are
refused, as is a renderer invocation in an element or attribute seat.

Named renderers are one member of the rendered statement family, not the only
semantic interpolation. Later running slices earn the exact show, row, field,
and ask nodes. The current ordered part representation is floor machinery and
may change without changing the authored syntax or statement semantics.
