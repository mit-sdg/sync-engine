# Public API

## `@mit-sdg/sync-engine-web/realization`

<!-- register:web-realization:start -->

`WebHead`, `realize`

<!-- register:web-realization:end -->

`realize({ system, interface, head? })` returns one complete Fetch
realization. The optional head seat carries material shared by every page: a
title, external stylesheet links (relative paths or `https:` URLs only), and
one admitted styles renderer formed once into the document head. It
claims `GET` and renderer-owned `POST` for selected endpoints whose admitted
closure returns renderers. `GET` opens one checked holder. `POST` admits only an
ask stored for that holder, resolves its declared field and formed-value inputs,
invokes the assembled concept action, and returns its result or refusal. A live
holder is process-local, so the opening document uses `Cache-Control: no-store`
and cannot be reused across a host restart. A live GET for that holder streams
newline-delimited addressed patch batches. Settled concept changes reform only
holders whose concrete read dependencies mention an affected concept, without
rerunning their endpoint invocation, and emit only when the newly formed HTML
differs. The stream uses blank-line keepalives, and the browser reconnects from
its last applied sequence. Retained history replays missed batches; an expired
history uses one root repair.
In-flight changes coalesce into a follow-up formation so a newly encountered
nested read cannot miss a concurrent change; a backpressured stream closes and
uses the same catch-up path.

An ask activates on click, and an armed submit button inside a form also
activates when the form submits, so field Enter uses native semantics. While an
ask is in flight its element carries `aria-busy="true"` and re-activation is
suppressed; authored `disabled` state is never touched, and CSS may style
`[aria-busy]`. An activation sends only the fields the ask declares, keyed by
seat address. A refusal's detail lands in the ask's declared refusal seats and
clears on the next acceptance; an ask without declared seats falls back to the
nearest enclosing `[data-rendered-answer]` element. Attribute patches address
elements through their `data-rendered-attrs` marker and set or remove one
attribute in place.
