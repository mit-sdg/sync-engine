# Public API

## `@mit-sdg/sync-engine-web/realization`

<!-- register:web-realization:start -->

`realize`

<!-- register:web-realization:end -->

`realize({ system, interface })` returns one complete Fetch realization. It
claims `GET` and renderer-owned `POST` for selected endpoints whose admitted
closure returns renderers. `GET` opens one checked holder. `POST` admits only an
ask stored for that holder, resolves its declared field and formed-value inputs,
invokes the assembled concept action, and returns its result or refusal. A live
GET for that holder streams newline-delimited addressed patch batches. Settled concept
changes reform only holders whose concrete read dependencies mention an
affected concept, without rerunning their endpoint invocation, and emit only
when the newly formed HTML differs. The stream uses blank-line keepalives, and
the browser reconnects from its last applied sequence. Retained history replays
missed batches; an expired history uses one root repair.
In-flight changes coalesce into a follow-up formation so a newly encountered
nested read cannot miss a concurrent change; a backpressured stream closes and
uses the same catch-up path.
