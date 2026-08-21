# Application implementation guidance

Application integration realizes approved composition, types, instance registration,
assembly, configuration, boundary projection, hosting, and artifact wiring. Use public
package subpaths and the supplied declaration references.

Use an implemented concept class directly. Do not wrap, adapt, subclass, or replace it
with a second behavior layer. Register each selected static instance exactly once under
its authored identity; never reuse one raw instance under two names or invent storage for
an authored instance.

Implement the exact authored reaction, view, former, and computation links. Keep module,
group, and declaration names aligned with those links, and register every declared
computation once. Composition coordinates concepts but does not absorb their invariants
or make separate owners atomic. Hosts project the application boundary and stay free of
product policy already owned by design.

Source-agreement diagnostics are semantic signals as well as wiring failures:
`MISSING_COVERAGE` and `UNRESOLVED_LINK` mean an authored executable link is absent or
cannot resolve; `UNDECLARED_SELECTED_INSTANCE` means wiring needs an identity the design
did not select; `UNREGISTERED_COMPUTATION` means an authored computation lacks its one
implementation registration. Do not conceal these conditions with alternate wiring.

Generated artifacts must come from the project's generation command and must never be
edited by hand.
