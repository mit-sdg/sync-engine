# Application implementation guidance

Application integration realizes approved composition, types, instance registration,
assembly, configuration, boundary projection, hosting, and artifact wiring. Use public
package subpaths and the supplied declaration references.

Use each implemented concept class directly; do not wrap, adapt, subclass, or replace it.
This assignment owns production registration. Import the approved Markdown specification as
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

When a generic concept class represents an authored external type, name the
application-specific class and register that name:

```ts
const Examining = ExaminingConcept<ExaminationOutcome>;
const examining = registerConcept({ class: Examining, spec });
```

The instantiation expression preserves concrete action and query signatures, including
generated wire projections, without creating a wrapper or subclass. The authored
`Outcome is ExaminationOutcome` binding remains a separate semantic contract; keep the
source specialization aligned with it.

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

Implement the exact authored endpoint reaction, selected internal reaction, view, former,
and computation links. An `endpoint(...)` is the reaction declaration named by its
`reaction:` link and uses the exact pathname from that identity's `endpoints` entry; it may
coordinate every consequence behaviorally assigned to that endpoint. Do not wrap it or
create it from prose alone. A separate internal reaction exists only when approved design
gives it a distinct link; do not duplicate its effect in the endpoint.

Before coding, compare every requested endpoint with both the complete supplied link
inventory and endpoint entries, then block on absence or disagreement. Keep module, group,
declaration name, and endpoint pathname aligned with those contracts, and register every
declared computation once. Within those
identities, choose documented stages, guards, binding flow, and fallback construction that
preserve the behavioral commitments. Composition coordinates concepts but does not absorb
their invariants or make separate owners atomic. Hosts project the application boundary
and stay free of product policy already owned by design. Do not infer registration shapes
or refusal maps from runtime failures; the supplied specifications and public surfaces
contain those facts.

Source-agreement diagnostics are semantic signals as well as wiring failures:
`MISSING_COVERAGE` and `UNRESOLVED_LINK` mean an authored executable link is absent or
cannot resolve. `UNRESOLVED_ENDPOINT`, `ENDPOINT_PATH_MISMATCH`, and `DUPLICATE_ENDPOINT`
mean endpoint identity/path declarations disagree with the selected assembly.
`UNDECLARED_SELECTED_INSTANCE` means wiring needs an identity the design did not select;
`UNREGISTERED_COMPUTATION` means an authored computation lacks its one implementation
registration. Do not conceal these conditions with alternate wiring.

Generated artifacts must come from the project's generation command and must never be
edited by hand. Construct a gateway with the generated core wire named by `wireName`, not
a transport projection type.
