# Public API

## `@mit-sdg/sync-engine-context/realization`

<!-- register:context-realization:start -->

`ContextAskAnswer`, `ContextRealization`, `ContextUnit`, `realize`

<!-- register:context-realization:end -->

`realize({ system, interface })` compiles and validates the interface's
context-family renderer closure and returns an in-process realization.
`open(invocation)` forms one deliberative unit from its root renderer
invocation and returns a `ContextUnit`: `formed()` reads the current
`FormedContext`, `reformed(listener)` subscribes to revised formations (the
returned function unsubscribes), `submit(askId, blanks)` admits one resolved
ask and answers with the action's accepted result or refusal, and `close()`
releases the unit. `realize(...).close()` closes every unit and detaches from
settled-change observation.

An `INVALID_ASK` refusal reports an unknown ask identity or a blank mapping
that does not match the formed ask's declared names; both are edge programming
errors, not concept refusals. A registered concept refusal arrives as
`{ ok: false, refusal }` with the concept's own code and detail. A fault in
the invoked action throws.
