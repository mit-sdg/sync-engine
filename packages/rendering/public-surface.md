# Public API

`@mit-sdg/sync-engine-rendering` has no root export or supported deep imports.

## `@mit-sdg/sync-engine-rendering/compiled`

<!-- register:rendering-compiled:start -->

`CompiledHtmlRendering`, `FormedAsk`, `FormedAskInput`, `FormedAskOutput`, `FormedAttributeNode`, `FormedClauseNode`, `FormedHtml`, `FormedHtmlContent`, `FormedHtmlNode`, `FormedHtmlPatch`, `FormedHtmlTree`, `FormedRead`, `FormedRendererNode`, `FormedRowNode`, `FormedShowNode`, `RenderingReader`, `compileHtml`, `diffHtml`

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

`AttributeValuePart`, `HtmlNode`, `Immediate`, `ImmediateArgKind`, `ImmediateDeclaration`, `ImmediateInvocation`, `ImmediateTrigger`, `Renderer`, `RendererAsk`, `RendererBindings`, `RendererBuilder`, `RendererDeclaration`, `RendererInputs`, `RendererInvocation`, `RendererRead`, `RendererValueRef`, `RenderingNode`, `each`, `html`, `immediate`, `isImmediate`, `isImmediateInvocation`, `isRenderer`, `isRendererInvocation`, `many`, `renderer`, `where`

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
are refused.

An attribute seat binds a value into an element attribute, and the seat's
spelling decides the semantics, never the value's runtime type. A **value
seat** (`title=${x}` or `class="card ${x}"`) takes strings; `null` or
`undefined` removes a sole-bound attribute, and a boolean is refused toward the
presence seat. A **presence seat** (`?disabled=${x}`) takes exactly one
boolean: `true` renders the bare attribute and `false` renders nothing.
`href=${x}` and `img src=${x}` check their rendered values to relative paths
and `https:` URLs; `iframe src=${x}` accepts relative paths only. Permanent
walls refuse `on*` handler attributes, `action`/`formaction`, `style`,
`srcset`, `.prop=` property seats, and any bound statement inside `<script>`,
`<style>` raw text, or `<script>`, `<link>`, `<base>`, and `<meta>` elements.

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

The third renderer bag supplies person-held fields and display seats. `${name}`
in an element seat marks that element as the holder of the field; it is not a
one-way show. A static concept action line in an element seat declares an ask.
Inputs may use renderer inputs, enclosing read bindings, or fields. An action
line qualified with `.responds({ profile })` may fill fields named in its
checked result mapping. An action line qualified with `.refuses({ refusal })`
names a display seat: arming an element with `${refusal}` re-kinds that
placement into a refusal seat that presents the ask's refusal detail and clears
on the next acceptance. A seat name may not double as a held field, and a named
refusal seat must be placed. One line carries one routing; an ask needing both
`.responds` and `.refuses` is a recorded gap awaiting a chain-preserving step
form.

Named renderers, shows, query-backed clauses, fields, and asks are members of
one rendered statement family. The current ordered part representation is floor
machinery and may change without changing the authored syntax or statement
semantics.

### `immediate`

```ts
immediate(description: string, contract: { on: "accepted" | "refused" } & Record<string, "field" | { many: "field" }>): Immediate
```

An immediate declares a local consequence of one armed element's ask outcome —
the declaration is realization-neutral and carries no code. Its canonical
interface export supplies identity, like a renderer's. Invoking it inside a
builder (`${ClearOnAccept({ fields: [draft] })}`) arms the element with inert
identity-and-args data, checked against the declared contract; args name
fields from the third bag, singly or via `many("field")`. A realization binds
the implementation by identity and refuses to realize an admitted renderer
whose immediates lack bindings. An immediate never writes concept State and
never sends asks; those rules are review-enforced discipline over registered
code, not a sandbox.
