# @mit-sdg/sync-engine-context

`@mit-sdg/sync-engine-context/realization` realizes the context-family
renderers of one named interface for in-process participant edges — a model
adapter, a deterministic machine, or another assembled system. Rendering forms
the checked participant-context unit; this package owns opening units, keeping
each formation current, and admitting resolved asks through the ordinary
assembled boundary. It carries no provider knowledge: tool names, parameter
schemas, request shapes, credentials, and call lifecycle belong to the
connected edge.

One deliberative unit is identified by its root renderer invocation —
canonical renderer identity plus resolved caller inputs — never by a transport
address. The trusted host opens a unit by passing that invocation directly;
serving a context realization to an outside connection is deliberately absent
until an outside edge exists. A collection of units is a collection of root
invocations discovered through an ordinary identified query; one formation
never flattens several units.

After a successful causal flow settles, a unit whose formed reads mention an
affected concept is reformed from its retained root invocation, and listeners
are notified only when the formed revision actually changed. Reformation
revises the projection; it never begins deliberation, and it never mutates a
call already in flight — the connected edge owns starting, continuing,
cancelling, and restarting its own calls. An ask submitted across a
reformation resolves against the current formation, exactly as a browser ask
resolves against its live page.

`submit(askId, blanks)` validates the supplied blanks against the formed ask's
declared names, forms the exact registered action occurrence, and admits it.
The answer returns the action's accepted result or its refusal; a fault in the
invoked action throws and remains edge-recorded call evidence. Nothing parses
a formation address.

## Public surface

See [`public-surface.md`](public-surface.md).
