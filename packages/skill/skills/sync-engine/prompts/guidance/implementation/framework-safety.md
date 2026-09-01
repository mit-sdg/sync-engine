# Framework use

Implement from supplied public references, examples, generated public contracts, and ordinary project diagnostics. Run relevant checks and repair in-scope code.

Do not discover undocumented APIs by reading framework source or built internals, searching `node_modules`, inspecting runtime values or exports, manufacturing invalid calls, or browsing generated implementation output. Public generated wire declarations may be used as caller contracts when granted.

A diagnostic may name an internal file; use the diagnostic without opening that file. If documented use fails and supplied context does not determine the repair, report a context or design blocker instead of probing alternate shapes.
