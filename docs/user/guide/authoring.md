# Author an application design

This guide adds the complete version-1 design contract to a config-based
sync-engine application: strict concept specifications, an explicit static
instance inventory, application types and bindings, typed prose coverage,
computations, and generated evidence. It applies to the
breaking beta contract described in the current reference pages. Older concept
files, manifests, generated artifacts, and `--vocabulary-module` workflows must
be replaced rather than mixed with this format.

Read [Designing with concepts](../design.md) before choosing concept boundaries.
Use the [Public API](../reference/public-api.md) for TypeScript signatures and
the [concept specification reference](../reference/concept-specification.md) for
exact file grammar.

## 1. Select the assembly variant

Decide which concept instances, implementations, reactions, endpoints, views,
formers, and computations one generated config assembles. Design completeness
is checked against the exact assembly returned by that config, not only against
syntactically visible `conceptSet` entries. This also applies to advanced
`vocabulary(...)` assemblies. The core-owned `RequestBoundary` is excluded from
the authored instance inventory. If the application supports another selection,
create another config and select the complete documents appropriate to that
variant.

For a new application, use `design/concepts/*.md`,
`design/compositions/*.md`, and `design/types.md`. Pair each composition document
with one `src/compositions/*.ts` module that realizes its linked decisions. The
checker follows the config, selected assembly, imported specifications, and typed
links rather than enforcing that layout, so an established application may use a
different explicit mapping.

Application-owned concepts should normally keep one flat specification per
definition under `design/concepts/`, named by its H1 identity:

```text
design/
  concepts/
    Commenting.md
    Posting.md
```

This is an authoring convention, not discovery or validation behavior. A
published concept package, monorepo package, or established repository may keep
the imported specification elsewhere. The registration import remains the sole
source of truth.

## 2. Write each concept specification

For every selected application-owned concept definition, create a Markdown file
with this exact top-level structure:

```text
# DefinitionName

## Purpose
## Principle
## Types
## State
## Actions
## Queries
```

Declare concept-external parameters in the sole `types` fence. The fence may be
empty: concept-owned identities, conventional values, and refinements used in
State or operation signatures are not additional Types declarations. Put one
SSF `state` fence in State. `check-design` parses its bounded structural
declarations, including owned identities, subsets, aliases, the subset graph, and name
uniqueness. Put invariant prose on a `Rule:` line and review it manually, since the
parser makes no claim about it.
Express enforced refinements in the owning action branches. Declare at least one
structured action with explicit branches, and put
the sole `queries` fence in Queries even when it is empty. Do not add subsection
headings, fenced blocks in Purpose or Principle, application typed links, or
computations.

Import the file as text and pass it to `registerConcept`. A specification under
the recommended layout is imported directly; it is not also listed in
`design.documents`:

```ts no-check
import spec from "@design/concepts/Commenting.md" with { type: "text" };

export const commenting = registerConcept({ class: CommentingConcept, spec });
```

The strict config check traces that import and rejects dynamic or unresolvable
specification construction. The H1 names the reusable definition; the
`conceptSet` key names each application instance.

Before implementation, verify the draft grammar without loading an application:

```sh
sync-engine check-design design/concepts/*.md
```

After registering the implementation, run config-based `sync-engine check` to add
source provenance, TypeScript shapes, result fields, optionality, and refusal mapping.
Do not leave those diagnostics unresolved.

## 3. Declare every instance and external binding

Put application `types` and `instances` fences in `design/types.md` and register
that document in the generated config. The checker accepts these fences in any
registered application document, but one dedicated file keeps the exact static
closure visible.

First declare each concrete type with a nonempty definition:

```types
concrete Person
  A stable identity supplied by the institution.
```

Then inventory every application concept instance selected by this config. The
bare form creates a same-name instance; it is only shorthand for the `as` form.
Supply every external parameter inline under `with`:

```instances
instantiate Posting

instantiate Commenting as PostComments with
  User is Person
  Target is Posting.Post
```

The definition comes from the registered specification H1. The instance name is
the selected assembly name used by composition and occurrences. A definition
may have several differently named instances and need not have a same-name
instance.

Inline binding is recommended. If the application deliberately centralizes
bindings, declare the instance without `with` and put all of that instance's
bindings in one or more dedicated fences:

```instances
instantiate Posting
instantiate Commenting as PostComments
```

```bindings
PostComments.User is Person
PostComments.Target is Posting.Post
```

Choose one placement per instance. Do not split its bindings between inline and
detached forms or repeat a binding in either form. An instance with no external
parameters uses the bare or `as` declaration and has no binding placement.
Detached declarations may merge across configured documents; names and bindings
remain globally unique.

Each right side directly names a declared concrete type or an owned type of
another declared, selected instance. The bounded SSF parser proves owned target
names, including a second spelling that the concept authors elsewhere as a singular or
plural pair, provided that pair is unambiguous; where it is not, declare
`alias Alias for Target`. Never target another instance's external parameter or a name
the parser could not resolve, and never chain one binding onto another. Direct qualified
owned-type dependencies may be cyclic because every target is checked
independently; declaration order does not resolve or prioritize them. Do not
leave a concrete type unused.

Keep explanations as ordinary prose adjacent to the relevant declaration fence;
`instances` and `bindings` bodies contain declarations only. The concept-set
module neither imports nor exports this Markdown. Register the containing
document in the generated config's `design.documents` array.

## 4. Explain application decisions with typed links

Create one ordinary Markdown document per composition source responsibility, each
with one nonempty H1. Organize it around application decisions rather than checker
categories, and pair it conventionally with a same-responsibility module under
`src/compositions/`. The checker permits a document to explain several modules (or
several documents to explain one), but use that flexibility only when the mapping
remains clearer.

Place exact typed links beside the claims they support:

```md
Editing a post [refreshes its derived content](reaction:Forum.posts.RefreshDerivedContent).
The [home feed](former:Forum.feed.HomeFeed) presents the selected posts.
Visibility follows the [readability policy](view:Forum.posts.Readable).
```

Standard Markdown reference links are also valid:

```md
Editing refreshes derived content.[refresh]

[refresh]: reaction:Forum.posts.RefreshDerivedContent
```

Use the declaration's dotted path in the selected composition. Link every
authored reaction or endpoint tree, every named view, and every named former at
least once. Do not use wildcards or assume that a parent path covers descendants.
A helper view or former still needs coverage.

Keep introductions, history, and unresolved notes in unregistered documentation
unless they also explain selected declarations. There is no required
`application.md`, design README, or directory index.

## 5. Declare computations where they are explained

Put each `computations` fence in the composition document whose decisions use it, or
in `design/types.md` when several modules share its meaning. The checker accepts the
fence in any registered application document. Each executable computation needs
exactly one declaration
with a nonempty indented body:

```computations
invitationMailText(invitation: String, credential: String) : String
  Produces the plain-text invitation containing the credential and sign-in URL.
```

Input names and optionality must match the executable registration. The result
is one bare type. Use an optional `computation:invitationMailText` link when
another passage refers to it. Do not put computations in concept
specifications.

Before implementation, form-check the complete authored corpus without loading
an application:

```sh
sync-engine check-design design/concepts/*.md design/compositions/*.md design/types.md
```

This preassembly check accepts a partial corpus and therefore checks form and
supplied-corpus duplicates, not link resolution, application type closure, or
coverage. The config-based check adds those assembly-dependent proofs.

## 6. Register explicit design URLs

Add a required versioned design block to the default export of
`generated.config.ts`:

```text
export default {
  assemble: assembleApplication,
  title: "Forum",
  design: {
    version: 1,
    documents: [
      new URL("./design/types.md", import.meta.url),
      new URL("./design/forum.md", import.meta.url),
      new URL("./design/access.md", import.meta.url),
    ],
  },
};
```

Every URL must use the local `file:` scheme. Relative URLs may point outside the
application directory, including elsewhere in a monorepo. Concrete declarations,
instance declarations, and detached bindings may be split across these documents under the global uniqueness and one-placement rules. Use
this explicit empty form only when the assembly selects no application concept
instances (the core-owned `RequestBoundary` does not require a declaration):

```text
design: { version: 1, documents: [] }
```

Do not import application design Markdown into composition source or store
`spec` strings on assembly records. Typed links and config registration provide
that connection.

## 7. Check and generate

Run the config-based check from the application package. When the package
exposes the conventional artifact script, use it to pin, then check directly:

```sh
sync-engine check
bun run artifacts:pin
sync-engine artifacts check
```

`check` defaults to `generated.config.ts`. It fails on malformed concept files,
unresolvable concept source and TypeScript shapes, an instance inventory that
differs from the exact assembled variant, incomplete external bindings,
unresolved typed links, or missing reaction/view/former/computation coverage.
Artifact pinning and checking enforce the same complete design contract.

Review generated diffs. Read-back links each covered declaration to every
authored source location and line. It reports lowering and structured
signatures, but it does not copy application prose, raw concept behavior prose,
or computation bodies. A prose-only source change still changes the design
input digest.

Commit the authored files, config, and regenerated artifacts together. Do not
hand-edit generated output.

## 8. Verify behavior separately

The design checker establishes declaration shape, source provenance, exact
instance and external-type closure, SSF-owned binding targets, and exact
coverage. It does not prove natural-language conditions, effects, invariant
sentences, computation semantics, State/storage agreement, persistence,
transactions, or runtime validation.

Test concept principles directly, composition scenarios through an assembly,
and storage constraints against the selected backend. Add endpoint validators
where untyped runtime input crosses the boundary. Then run the application's
full test and typecheck scripts.

## Migrate an older beta application

This revision is a hard beta break. Before upgrading, retain the old pinned
version if rollback is required; new manifests and artifacts cannot be consumed
by the old format.

1. Rewrite every concept file into the six strict ordered sections.
2. Replace prose Types with explicit `external` declarations.
3. Rewrite State in the published SSF notation without inventing a private dialect;
   run `check-design` for bounded structural parsing and review invariant/prose
   meaning manually.
4. Rewrite action branches and query result rows into the structured grammar, and give
   every query an explanatory body.
5. Keep only `concrete` declarations in application `types` fences. Preserve each
   existing binding explanation as nearby ordinary prose.
6. Add one complete `instances` inventory per configured variant. Move each old
   `Instance.External is Target` line either under that instance's inline `with`
   block or into a dedicated `bindings` fence; never split one instance across both.
7. Remove composition `spec` imports and add exact typed links to registered
   application prose.
8. Add declarations for every executable computation.
9. Add `design: { version: 1, documents }` to each generated config.
10. Remove `--vocabulary-module`; run `sync-engine check` or pass `--config`.
11. Regenerate every manifest and generated artifact, then rerun tests.

There is no legacy parser, compatibility flag, automatic format detection, or
old-manifest decoder. Migration failures name the missing or malformed required
construct. Rollback requires restoring the old authored files, config, package,
and generated artifacts together.
