# Concept specification and application-design processing

This document explains the version-1 processing boundary for authored design.
The [concept specification reference](../user/reference/concept-specification.md)
and [CLI reference](../user/reference/cli.md) own the consumer contract. This
page owns implementation relationships, enforcement limits, and deferred design
questions.

## Two input families, one selected design

Tooling combines two authored input families for the exact assembly selected by
one generated config:

| Input                             | Machine-readable contribution                                                                                       |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Registered concept specifications | Definition identity, external parameters, full State plus bounded structural IR, actions/queries, and provenance    |
| Registered application documents  | Links, computations, concrete types, complete instances, inline/detached bindings, normalized source, and locations |

The executable assembly supplies selected concept instances, authored reaction
and endpoint trees, named views, named formers, and executable computations.
The checker joins the authored and executable inventories. It does not infer a
corpus from directories, composition modules, or conventional filenames.

## Processing pipeline

```text
generated config
  -> statically resolve design URLs and concept-spec imports
  -> assemble the selected variant
  -> parse concept specifications and application documents
  -> resolve TypeScript declaration shapes
  -> join exact assembled definition/instance identities
  -> validate complete instances, bindings, and declaration coverage
  -> canonicalize provenance and source digests
  -> inspect lowering and executable contracts
  -> emit manifest/read-back/wire or compare pinned artifacts
```

`sync-engine check`, generated-artifact creation, and generated-artifact checking
use this complete pipeline. Runtime `assemble(...)` does not load design files
and therefore has no deployment-time dependency on Markdown.

## Concept parser boundary

The concept parser recognizes one H1 and the exact ordered H2 sequence Purpose,
Principle, Types, State, Actions, and Queries. Unknown, duplicate, missing, or
reordered H2 sections and all subordinate headings fail. Purpose and Principle
are nonempty prose without fenced blocks. Markdown application-design links and
`computations` fences fail anywhere in the specification.

Its version-1 IR retains:

- concept-definition name;
- Purpose and Principle;
- ordered external declarations and their optional explanations;
- normalized full State fence text and bounded structural SSF IR;
- definition-owned identity/type names with singular/plural normalization and subset structure;
- structured action inputs and named result rows;
- structured branches and terminal return/refusal outcomes;
- query inputs, cardinality, named rows, and optional prose bodies; and
- one-based source locations.

The format remains named `sync-engine.concept-specification`, version `1`. This
is a beta redefinition, not compatibility with the former version-1 grammar.
There is no legacy parser or format auto-detection.

### State has a bounded structural parser

The workspace-private, unpublished `packages/ssf` package owns SSF tokenization,
canonical structural diagnostics, type-name normalization, and structured State IR.
It remains `private: true`, has no release-owned publication entry, and has no
dependency on sync-engine Markdown or source-location types. It returns text spans or
line/column offsets, and the tooling adapter maps those spans to
`DesignSourceLocation`. Keep this parser as the one implementation used both for
repair diagnostics and owned-name extraction; do not recreate a second parser under
`src/engine/tooling`.

The parser increment is deliberately bounded. It authoritatively parses structural
set, sequence, element, subset, and field declarations; normalizes consistent
singular/plural forms; records subset structure; and inventories names the definition
owns. It preserves the complete normalized State text. Standalone invariant sentences
and admitted prose remain opaque. The parser must not claim to prove those sentences,
conditions, effects, query meaning, storage layout, State/storage agreement, or
implementation semantics.

Config-based binding validation uses only the established owned-name inventory. A
qualified target must name an owned type of the selected target instance's definition;
an external parameter is independently invalid. This proof does not imply that every
action/query type must be declared in State: conventional and refinement names remain
valid in operation signatures under the public contract.

## Static source agreement

Strict checking traces the Markdown import passed to each selected
`registerConcept` call, verifies source bytes against registered text, and
records the path. Dynamic or unresolvable spec construction fails. Source URL is
not duplicated in runtime registration.

TypeScript resolution compares member names and the finite top-level shapes of
inputs, action results, and query rows, including optionality. The checker also
compares successful action terminal return names and registered refusal
mappings. It fails closed when a shape cannot be resolved.

This comparison intentionally stops short of semantic type-name equivalence.
Concept identity types commonly erase to `string`; State and persistence have no
machine comparison until a separately designed State contract exists.

## Definition and instance joins

The H1 identifies a reusable concept definition. A `conceptSet` property
identifies an application instance. Advanced `vocabulary(...)` assembly remains
supported, so full checking derives canonical `(instance, definition)` facts from
the exact assembled variant rather than treating syntactic concept-set discovery as
the selected inventory. Static concept-set discovery remains a configured source and
TypeScript anchor. The core-owned `RequestBoundary` is excluded from authored
completeness.

Authored `instances` declarations merge across configured application documents and
must match those assembled facts bidirectionally. `instantiate D` normalizes to
`(definition: D, instance: D)`; `instantiate D as I` normalizes to `(D, I)`. A
definition may have no same-name instance. Every instance name is globally unique.
Definition mismatches should suppress external-closure diagnostics for that instance
to avoid checking against the wrong parameter list.

When selected registrations share a definition name, their canonical
specifications must be equal. Implementation class or floor may differ without
changing definition identity. Generated read-back renders one definition contract
and lists its selected instances, declarations, and bindings rather than duplicating
the contract.

## Instance and application-type processing

Any registered application document can contain `types`, `instances`, and
`bindings` fences. `types` contains only `concrete` declarations with required prose.
An instance declaration is bare, renamed, or followed by a nonempty indented `with`
body of local bindings. Detached bindings use
`ConceptInstance.External is Target` in dedicated `bindings` fences. Arbitrary prose
is not part of either declaration body; migration retains old binding explanations as
adjacent ordinary Markdown.

Validation combines the complete configured corpus and enforces:

- every assembled non-core instance has exactly one authored instantiation and every
  authored instance is assembled;
- the authored definition equals the selected specification H1;
- every selected external parameter is bound exactly once, and no unknown external is
  bound;
- each instance supplies all bindings inline or all detached, never a mixture;
- every right side directly names a declared concrete type or an SSF-owned type of a
  declared and selected target instance;
- no target is an external parameter and no binding chain is resolved;
- duplicates are invalid even when targets are textually identical; and
- every concrete type is used.

Declaration order has no semantics. Direct qualified targets resolve independently,
so cyclic instance dependencies are valid when every edge ends at an owned type.
External-to-external edges remain invalid, including cycles, because they would be
aliases with no direct concrete or owned target. Placement errors take precedence over
duplicate and missing-binding cascades; zero-external instances have no placement.

The containing document's prose is included in digests and may also contain typed
links and computation fences. An instances-only document is valid application
content. The concept-set source has no Markdown import/export path;
`design.documents` is the sole registration path.

## Application-document processing

Each configured document is a local `file:` URL and contains one nonempty H1.
No other heading structure has parser significance. `types` and `computations`
fences may appear in any of these documents. The Markdown link parser
supports inline and standard reference-style links with the destination schemes
`reaction:`, `view:`, `former:`, and `computation:`.

Declaration links resolve by exact dotted authored identity. Identity derives
from the selected composition path and uses restricted path segments. The same
declaration object cannot be installed under several paths.

Coverage joins are bidirectional:

- every typed link resolves to one selected declaration of the stated kind;
- every selected authored reaction or endpoint tree has a reaction link;
- every selected named view has a view link;
- every selected named former has a former link; and
- executable and authored computation definitions correspond one-to-one.

One authored reaction or endpoint tree is the version-1 coverage unit, even when
lowered into several runtime reactions. Core-generated boundary and outcome
reactions are exempt. No view/former helper category, wildcard, namespace
coverage, or implied descendant exists.

The parser does not interpret surrounding prose and emits no heuristic warning
for apparently unlinked sentences. Multiple source locations for one declaration
are retained without selecting a primary location.

## Computation processing

Any registered application document can contain any number of `computations`
fences. Declarations are globally unique for the selected design. Each has a
signature and nonempty prose body.

Validation compares executable and authored names, input names, and optionality.
Semantic type equivalence, result validation, and body meaning remain authored
contracts. A computation returns one value and therefore retains a bare result
type, unlike concept action/query result rows.

## Canonical provenance and artifacts

Canonical provenance includes normalized complete contents of every registered
application document, not only extracted links. A prose-only change changes the
input digest.

The application manifest remains `sync-engine.application-manifest`, version
`1` under the intentional pre-1.0 beta reset. It retains full State and bounded
structural IR, structured declarations, authored definition/instance provenance,
instance-owned normalized bindings, application-type resolution, source locations,
and design digests. The earlier beta version-1 shape and prior versions are
rejected without upconversion.

Generated Markdown links to prose rather than copying it. Paths are relative and
host-independent; one-based lines are shown separately. It lists every source
location covering a declaration. Concept read-back omits Purpose, Principle,
full State text, action/query bodies, and application prose while still exposing
structured signatures, cardinality, refusals, instances, bindings, computation
signatures, and executable lowering.

## Enforcement ownership

TypeScript concept class signatures and registered vocabulary computation
function signatures, not Markdown types or results, drive authoring types and
wire provenance.

| Property                                                   | Enforcement owner                        |
| ---------------------------------------------------------- | ---------------------------------------- |
| Section and fence grammar                                  | Concept and application document parsers |
| Source text and TypeScript shape agreement                 | Config-based static checker              |
| Exact non-core definition/instance inventory and closure   | Assembly inspection plus design checker  |
| Qualified target ownership                                 | Private SSF parser plus design checker   |
| Reaction/view/former/computation coverage                  | Design checker                           |
| Design source digests and links                            | Manifest/artifact tooling                |
| Query cardinality during evaluated reads                   | Runtime read evaluation                  |
| Opaque prose/invariants, storage, transactions, durability | Review and tests                         |

Repository-owned catalog validation may use internal validation until a
supported low-level checker is designed. The installed CLI no longer exposes
`--vocabulary-module` or an unconfigured concept-set mode.

## Hard beta migration

Implementation and repository migration replace the old format in one break:
there is no compatibility flag, legacy parser, automatic detection, old-manifest
decoder, runtime composition/design Markdown import, or partial artifact
success. Examples, catalog data, packaging fixtures, tests, declarations, docs,
and generated artifacts must move together before downstream applications.

## Deferred design questions

1. **Broader SSF semantics.** Decide whether later parser increments should typecheck all operation vocabulary or formalize invariant sentences without making prose claims the structure cannot prove.
2. **Concrete-type taxonomy.** Reconsider whether provisional `concrete` should distinguish application-owned, platform-owned, and externally supplied types.
3. **Reaction-tree granularity.** Reconsider whether authored reaction and endpoint trees should require branch- or consequence-level design coverage.
4. **Low-level concept checker.** Design a supported concept-only checker to replace the removed `--vocabulary-module` mode without weakening config-based application guarantees.
