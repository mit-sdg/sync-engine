# Concept specification and application-design processing

This document explains the version-1 processing boundary for authored design.
The [concept specification reference](../user/reference/concept-specification.md)
and [CLI reference](../user/reference/cli.md) own the consumer contract. This
page owns implementation relationships, enforcement limits, and deferred design
questions.

## Two input families, one selected design

Tooling combines two authored input families for the exact assembly selected by
one generated config:

| Input                             | Machine-readable contribution                                                                          |
| --------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Registered concept specifications | Definition identity, external parameters, raw State, structured actions/queries, and source provenance |
| Registered application documents  | Links, computations, concrete types, external bindings, full normalized source, and locations          |

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
  -> join definition and instance identities
  -> validate application types and declaration coverage
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
- normalized raw State fence text;
- structured action inputs and named result rows;
- structured branches and terminal return/refusal outcomes;
- query inputs, cardinality, named rows, and optional prose bodies; and
- one-based source locations.

The format remains named `sync-engine.concept-specification`, version `1`. This
is a beta redefinition, not compatibility with the former version-1 grammar.
There is no legacy parser or format auto-detection.

### State is deliberately raw

The State fence is normalized and retained but not parsed into structured IR. Its
intended language is SSF; the grammar is not yet stable enough for an authoritative
parser. Registration and assembly therefore do not depend on a partial parser,
heuristic type scan, or private dialect.

The independent `simple-state-form.ts` tooling module receives source-positioned
Markdown fence lines and reports only a fixed set of recognized, mechanically
repairable form issues. `check-design` runs it after the concept parser accepts the
document and fails with every repair for that file. The validator ignores every line
it cannot positively classify and neither changes concept IR nor runs during
registration. New rules must preserve that recovering boundary and provide one
concrete better form.

Consequently source checking cannot yet prove state-owned type use, external
parameter use, State/storage agreement, or the final owned type on a qualified
type-binding target. Named types used by State, actions, and queries do not need
local declarations; Types inventories only external application parameters.
These absent proofs are explicit limitations rather than warnings generated from
guesses.

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
identifies an application instance. Canonicalization stores both.

When selected registrations share a definition name, their canonical
specifications must be equal. Implementation class or floor may differ without
changing definition identity. Generated read-back renders one definition
contract and lists its selected instances and bindings rather than duplicating
the contract.

## Application-type processing

Any registered application document can contain `types` fences. The parser
records `concrete` declarations with required prose definitions and
`ConceptInstance.External is Target` bindings with optional explanations.
Validation combines every fence in the registered corpus.

Validation joins against the exact selected assembly and enforces:

- every selected external parameter is bound exactly once;
- every left side names a selected instance and declared external parameter;
- every right side directly names a concrete type or selected concept-owned
  type;
- no target is an external parameter;
- no chain, cycle, duplicate, missing, or unresolved binding exists; and
- every concrete type is used.

The current unparsed-State boundary permits checking the target instance but not
proving its final owned type name. That proof remains deferred.

The containing document's prose is included in digests and may also contain
typed links and computation fences. The concept-set source has no Markdown
import/export path; `design.documents` is the sole registration path.

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

The application manifest resets to `sync-engine.application-manifest`, version
`1`. It retains raw State, structured declarations, definition/instance joins,
application-type resolution, source locations, and design digests. Old manifest
versions are rejected without upconversion.

Generated Markdown links to prose rather than copying it. Paths are relative and
host-independent; one-based lines are shown separately. It lists every source
location covering a declaration. Concept read-back omits Purpose, Principle,
raw State, action/query bodies, and application prose while still exposing
structured signatures, cardinality, refusals, instances, bindings, computation
signatures, and executable lowering.

## Enforcement ownership

TypeScript concept class signatures and registered vocabulary computation
function signatures, not Markdown types or results, drive authoring types and
wire provenance.

| Property                                                      | Enforcement owner                        |
| ------------------------------------------------------------- | ---------------------------------------- |
| Section and fence grammar                                     | Concept and application document parsers |
| Source text and TypeScript shape agreement                    | Config-based static checker              |
| Selected definition/instance inventory                        | Assembly inspection plus checker join    |
| Application-type closure                                      | Design checker                           |
| Reaction/view/former/computation coverage                     | Design checker                           |
| Design source digests and links                               | Manifest/artifact tooling                |
| Query cardinality during evaluated reads                      | Runtime read evaluation                  |
| Prose truth, State meaning, storage, transactions, durability | Review and tests                         |

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

1. **Authoritative SSF grammar and parser.** Choose the final external grammar, parse State into structured IR, validate owned and parameter types, and compare type-binding targets with state-owned types. The limited form validator is deliberately not this parser.
2. **Concrete-type taxonomy.** Reconsider whether provisional `concrete` should distinguish application-owned, platform-owned, and externally supplied types.
3. **Reaction-tree granularity.** Reconsider whether authored reaction and endpoint trees should require branch- or consequence-level design coverage.
4. **Low-level concept checker.** Design a supported concept-only checker to replace the removed `--vocabulary-module` mode without weakening config-based application guarantees.
