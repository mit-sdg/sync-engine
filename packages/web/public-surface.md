# Public API

## `@mit-sdg/sync-engine-web/realization`

<!-- register:web-realization:start -->

`CandidateManifest`, `CandidateSelection`, `ImmediateBindings`, `RenderedFault`, `SelectionApplication`, `WebCandidate`, `WebHead`, `WebRealization`, `applySelection`, `assembleCandidate`, `candidatePathPrefix`, `interfaceRevision`, `realize`

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

`realize` returns a `WebRealization`: the Fetch realization plus `revision()`,
`promote(candidate)`, and `close()`. `interfaceRevision(binding)` is the
canonical content revision — a hash over the lowered declarations of the
interface's members and reachable dependencies, each rendered endpoint
contributing its route and exact root invocation — so two interfaces with the
same canonical content share a revision regardless of the modules that
carried them.

`assembleCandidate({ system, exports, interface, head?, immediates?, source?, base? })`
assembles one interface-only candidate against the running system: it
validates the complete claims (canonical exports, renderer closure, routes,
bound immediates, head) and constructs the realization without serving
anything, returning an immutable `WebCandidate` or throwing a named refusal.
The candidate's preview realization serves ordinary live holders over the
same system under `candidatePathPrefix` plus the revision; candidate
endpoints must be exact literal rendered endpoints (`receive({})` responding
with one renderer invocation), and may not claim paths inside the reserved
prefix. The manifest retains the authored `source` whole and carries the
candidate's display `name` and `requester` attribution, so a record of the
candidate — what it is called, who asked, when — projects directly from it.
Discarding a candidate is `candidate.realization.close()`: its holders close
and nothing durable changes.

`promote(candidate)` makes the candidate what the accepted claims serve,
atomically for new opens; the claim set changes with it. Holders already
open are repaired with one root patch: the repair re-runs the holder's
endpoint under the new revision and replaces the rendered root, so two
revisions need no correspondence between their authored clauses. A holder
whose endpoint the new surface no longer declares closes; its page marks the
rendered root `data-rendered-gone` when the stream is gone. Held drafts do
not survive promotion. Promotion refuses a candidate assembled against
another system, and promoting a retained earlier candidate is the same act —
restore needs no separate machinery.

`applySelection({ sourceRevision, selection })` states the startup precedence
for a durable `CandidateSelection` completely: `spent` when the source
already carries the selected revision, `apply` when it matches the
selection's base, and `stale` — serve the source, surface the selection —
when the source moved on. A selection is never silently applied over newer
source and never silently dropped.

## `@mit-sdg/sync-engine-web/immediates`

<!-- register:web-immediates:start -->

`ClearOnAccept`, `RefocusOnRefusal`, `stockImmediates`

<!-- register:web-immediates:end -->

Stock immediates for the common local consequences: `ClearOnAccept` empties
its declared fields after the armed element's ask is accepted, and
`RefocusOnRefusal` focuses its declared field after a refusal. Each is a
realization-neutral declaration to re-export from an application's interface
module; `stockImmediates` carries their browser implementations for
`realize({ immediates })`.
