# Public API

`@mit-sdg/sync-engine-rendering` has no root export or supported deep imports.

## `@mit-sdg/sync-engine-rendering/language`

<!-- register:rendering-language:start -->

`HtmlNode`, `Renderer`, `RendererDeclaration`, `RendererInputs`, `RendererInvocation`, `RenderingNode`, `html`, `isRendererInvocation`, `renderer`

<!-- register:rendering-language:end -->

### `renderer`

```ts
renderer<Inputs extends RendererInputs = Record<string, never>>(
  name: string,
  body: RenderingNode,
): Renderer<Inputs>
```

The returned renderer is callable. Calling it produces a `RendererInvocation`: the renderer declaration under `$renderer`, with every caller input beside it at the mapping's top level. The declaration and invocation are inert portable data. A blank name or a caller input named `$renderer` is rejected.

### `html`

```ts
html(strings: TemplateStringsArray): HtmlNode
```

`html` records one static tagged template as a portable HTML node. Interpolations are refused until named renderer composition defines their binding and identity semantics. Interface companions decide how the node is displayed.
