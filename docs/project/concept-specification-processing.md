# Concept specification and application-design processing

This document explains the version-1 processing boundary for authored design.
The [concept specification reference](../user/reference/concept-specification.md)
and [CLI reference](../user/reference/cli.md) own the consumer contract. This
page owns implementation relationships, enforcement limits, and deferred design
questions.

## Two input families, one selected design

Tooling combines two authored input families for the exact assembly selected by
one generated config:

| Input                             | Machine-readable contribution                                                                                                 |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Registered concept specifications | Definition identity, external parameters, raw State, structured actions/queries, and source provenance                        |
| Registered application documents  | Links, computations, concrete types, complete instance declarations, normalized external bindings, full source, and locations |

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

### Raw registration State and structured SSF tooling

The concept-specification IR still normalizes and retains the State fence as raw text.
Registration and assembly do not derive a runtime schema from it. Structural tooling is
owned separately by the private `packages/ssf` workspace: it tokenizes State, parses
set, sequence, element, subset, field, enumeration, primitive, and external-reference
forms, and returns package-local text spans. Standalone invariant sentences and lines
outside that bounded grammar remain opaque State lines.

The parser builds one definition-owned identity/type inventory. Top-level structural
declarations introduce identities unless their normalized name is a declared external
parameter or primitive; subset names are owned types. Type-name joins use one
centralized singular key, with ordered regular suffix rules and explicit lexical
exceptions, so declarations such as `Entries` prove references to `Entry` without
call-site heuristics.

`src/engine/tooling/simple-state-form.ts` is the Markdown adapter. It maps package-local
spans to `DesignSourceLocation` and exposes the existing repair-validator contract.
`check-design` fails on the fixed set of recognized, mechanically repairable canonical
form issues. Repair validation and owned-name extraction therefore share one tokenizer
and grammar implementation. Unknown lines remain opaque and never become guessed
owned types.

Instance validation consumes the complete normalized owned-name inventory for each
selected definition, including accepted singular/plural variants and subset names.
Qualified binding targets must name a selected instance's definition-owned type;
external parameter targets remain invalid. Source checking still does not compare State
with class fields or storage. Named types used by State, actions, and queries do not
need local declarations; Types inventories only external application parameters.

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

## Instance and application-type processing

Any registered application document can contain `instances`, `bindings`, and
`types` fences. An `instances` fence declares `instantiate Definition`, its
normalized equivalent `instantiate Definition as Definition`, or
`instantiate Definition as Instance`. A declaration can append `with` and one
or more indented local bindings. A `bindings` fence supplies detached
`Instance.External is Target` declarations. A `types` fence contains only
`concrete` declarations with required prose definitions.

The parser retains every instance declaration and binding location. Detached
binding explanations are retained in parsed provenance and the manifest. The
corpus merge is global and declaration order has no semantic effect. An instance
uses either inline or detached placement, never both; mixed placement is
reported before duplicate or missing-binding consequences.

Validation joins against the exact facts exported by the assembled variant,
not the syntactically discovered concept-set map. Advanced `vocabulary(...)`
assemblies remain valid, and the core-owned `RequestBoundary` is excluded. The
join enforces:

- every selected application instance has exactly one authored instantiation,
  and every authored instance is selected;
- the authored definition equals the selected specification H1;
- every selected external parameter is bound exactly once;
- every binding belongs to its declared instance and names one external
  parameter of the matched definition;
- every target directly names a concrete type or selected qualified type;
- no target is another external parameter, so alias chains are impossible; and
- every concrete type is used.

Cycles among direct qualified targets are valid: each edge terminates at a
purported owned type and no alias expansion or topological evaluation occurs.
The current unparsed-State boundary proves only selected-qualified-nonexternal
targets unless the owned-name adapter is supplied. Definition mismatches suppress
external-closure diagnostics for that instance so the checker does not validate
against the wrong parameter inventory.

The containing document's prose is included in digests and may also contain
typed links and computation fences. The concept-set source has no Markdown
import/export path; `design.documents` is the sole registration path.

## Application-document processing

Each configured document is a local `file:` URL and contains one nonempty H1.
No other heading structure has parser significance. `types`, `instances`,
`bindings`, and `computations` fences may appear in any of these documents. An
instances-only document is application content. The Markdown link parser
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
`1`, but its beta schema is intentionally replaced in place. Each definition's
instances own normalized bindings, instance declaration provenance, binding
locations, and retained detached explanations. `design.types` owns only concrete
application types. No reader accepts the former beta version-1 shape. The
manifest also retains raw State, structured declarations, source locations, and
design digests.

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

1. **Full SSF semantic validation.** Extend the bounded structural parser when the external language settles further, validate hierarchy and field constraints beyond canonical repairs, and compare application binding targets with the package-owned inventory.
2. **Concrete-type taxonomy.** Reconsider whether provisional `concrete` should distinguish application-owned, platform-owned, and externally supplied types.
3. **Reaction-tree granularity.** Reconsider whether authored reaction and endpoint trees should require branch- or consequence-level design coverage.
4. **Low-level concept checker.** Design a supported concept-only checker to replace the removed `--vocabulary-module` mode without weakening config-based application guarantees.
