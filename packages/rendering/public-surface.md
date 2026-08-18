# Public API

`@mit-sdg/sync-engine-rendering` has no root export or supported deep imports.

## `@mit-sdg/sync-engine-rendering/compiled`

<!-- register:rendering-compiled:start -->

`CompiledHtmlRendering`, `FormedAsk`, `FormedAskInput`, `FormedAskOutput`, `FormedClauseNode`, `FormedHtml`, `FormedHtmlContent`, `FormedHtmlNode`, `FormedHtmlPatch`, `FormedHtmlTree`, `FormedRead`, `FormedRendererNode`, `FormedRowNode`, `FormedShowNode`, `RenderingReader`, `compileHtml`, `diffHtml`

<!-- register:rendering-compiled:end -->

`compileHtml(...)` checks the HTML renderer closure admitted by one bound
interface. The returned value asynchronously forms endpoint-returned renderer
invocations into transport-neutral HTML fragments. A `RenderingReader` resolves
the declared concept-query reads encountered while forming. Each `FormedHtml`
retains those reads as concrete `FormedRead` values containing concept, query,
and formed input. This is a dependency footprint for realizations; it is not a
fourth authored binding bag or an additional query mechanism.

Each formation also retains a standing tree addressed from authored renderer,
show, and read positions. An identified `many` query contributes its declared
row identity to descendant addresses. `diffHtml(...)` compares two formations
of one holder and emits semantic show, clause, or ordered-row patches. Moving
an identified row therefore moves its existing browser range; entering or
leaving rows does not replace siblings. An unidentified repeated query falls
back to replacement of its own clause, never to positional identity.

## `@mit-sdg/sync-engine-rendering/language`

<!-- register:rendering-language:start -->

`HtmlNode`, `Renderer`, `RendererAsk`, `RendererBindings`, `RendererBuilder`, `RendererDeclaration`, `RendererInputs`, `RendererInvocation`, `RendererRead`, `RendererValueRef`, `RenderingNode`, `each`, `html`, `isRenderer`, `isRendererInvocation`, `renderer`, `where`

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
node. `${value}` shows an input or read binding in a text seat with HTML
escaping. A direct renderer invocation such as `${Heading({})}` places that
named renderer in a subtree position. Arbitrary computed values and callbacks
are refused, as are show and renderer statements in unsupported element or
attribute seats.

`each(query(...).is(...)).html` repeats one declared subtree for the query's
rows. `where(query(...).is(...)).html` conditionally forms one subtree. Query
inputs may use renderer inputs or enclosing read bindings, and query outputs
bind names from the renderer's second bag. Both lower static concept and query
identity rather than executable callbacks.

Rendering `each` consumes the same core `ReadLine` as the main language's
`each`. They are distinct terminal builders: core `each` offers data-forming
consumers such as `.form()`, `.count()`, and `.first()`, while rendering `each`
offers `.html`. Keeping the HTML terminal here prevents the core language from
depending on a rendering format.

The third renderer bag supplies person-held fields. `${name}` in an element
seat marks that element as the holder of the field; it is not a one-way show.
A static concept action line in an element seat declares an ask. Inputs may use
renderer inputs, enclosing read bindings, or fields. An action line qualified
with `.responds({ profile })` may fill fields named in its checked result mapping.

Named renderers, shows, query-backed clauses, fields, and asks are members of
one rendered statement family. The current ordered part representation is floor
machinery and may change without changing the authored syntax or statement
semantics.
