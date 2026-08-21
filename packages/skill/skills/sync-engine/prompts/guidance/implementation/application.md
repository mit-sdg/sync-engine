# Application implementation guidance

Application integration realizes approved composition, types, instance registration,
assembly, configuration, boundary projection, hosting, and artifact wiring. Use public
package subpaths and the supplied declaration references.

Use each implemented concept class directly; do not wrap, adapt, subclass, or replace it.
The application worker owns registration. Import the approved Markdown specification as
text, map every declared refusal code to the supplied stable error class, and pass the
resulting descriptor—not the raw class—to `conceptSet`:

```ts
import { conceptSet, registerConcept } from "@mit-sdg/sync-engine/assembly";
import spec from "@design/concepts/Posting.md" with { type: "text" };
import { InvalidPostContent, PostingConcept } from "./concepts/Posting.ts";

const posting = registerConcept({
  class: PostingConcept,
  spec,
  refusals: { INVALID_POST_CONTENT: InvalidPostContent },
});
export const applicationConceptSet = conceptSet({ Posting: posting });
```

Register every selected static instance exactly once under its authored identity. Never
reuse one raw instance under two names or invent storage for an authored instance. For
default-constructible concepts, assemble the registered set with explicit fresh
implementations:

```ts
assemble({
  conceptSet: applicationConceptSet,
  instances: applicationConceptSet.implementations(),
  composition,
});
```

Implement the exact authored endpoint reaction, internal reaction, view, former, and
computation links. An `endpoint(...)` is itself the reaction declaration named by its
`reaction:` link; do not wrap it or create it from route prose alone. Before coding,
compare every requested endpoint with the complete supplied link inventory and block on
any missing link. Keep module, group, and declaration names aligned with those links, and
register every declared computation once. Composition coordinates concepts but does not absorb their invariants
or make separate owners atomic. Hosts project the application boundary and stay free of
product policy already owned by design. Do not infer registration shapes or refusal maps
from runtime failures; the supplied specifications and public surfaces contain those
facts.

Source-agreement diagnostics are semantic signals as well as wiring failures:
`MISSING_COVERAGE` and `UNRESOLVED_LINK` mean an authored executable link is absent or
cannot resolve; `UNDECLARED_SELECTED_INSTANCE` means wiring needs an identity the design
did not select; `UNREGISTERED_COMPUTATION` means an authored computation lacks its one
implementation registration. Do not conceal these conditions with alternate wiring.

Generated artifacts must come from the project's generation command and must never be
edited by hand.
