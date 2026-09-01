# Framework use

Implement from supplied public references, examples, generated public contracts, and ordinary project diagnostics. Run relevant checks and repair in-scope code.

Never open `node_modules`, package `dist` files, or framework internals during the assignment, including declaration files. Do not discover undocumented APIs by inspecting runtime values or exports, manufacturing invalid calls, or browsing generated implementation output. Required public documentation and declaration excerpts must be supplied inline; public generated wire declarations may be used as caller contracts only when granted.

A diagnostic may name an internal file; use the diagnostic without opening that file. If documented use fails and supplied context does not determine the repair, report a context or design blocker instead of probing alternate shapes.
