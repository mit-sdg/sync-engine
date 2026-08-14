# Author an application design

This guide adds the complete version-1 design contract to a config-based
sync-engine application: strict concept specifications, application vocabulary,
typed prose coverage, computations, and generated evidence. It applies to the
breaking beta contract described in the current reference pages. Older concept
files, manifests, generated artifacts, and `--vocabulary-module` workflows must
be replaced rather than mixed with this format.

Read [Designing with concepts](../design.md) before choosing concept boundaries.
Use the [Public API](../reference/public-api.md) for TypeScript signatures and
the [concept specification reference](../reference/concept-specification.md) for
exact file grammar.

## 1. Select the assembly variant

Decide which implementations, reactions, endpoints, views, formers, and
computations one generated config assembles. Design completeness is checked
against that exact selection. If the application supports another selection,
create another config and select the documents appropriate to that variant.

Application files may use any sensible layout. The checker follows the config,
selected assembly, imported concept specifications, and typed links; it does not
require design and source trees to mirror each other.

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

Declare concept-external parameters in the sole `types` fence. Put one raw
`state` fence in State. Declare at least one structured action with explicit
branches, and put the sole `queries` fence in Queries even when it is empty.
Do not add application typed links or computations.

Import the file as text and pass it to `registerConcept`. The strict config check
traces that import and rejects dynamic or unresolvable specification
construction. The H1 names the reusable definition; the `conceptSet` key names
each application instance.

Verify the specification before continuing:

```sh
sync-engine check --config generated.config.ts
```

At this stage, vocabulary and coverage errors are expected if those documents
are not registered yet. Concept grammar, source provenance, unresolved
TypeScript shapes, result fields, optionality, and refusal mappings should not
be left unresolved.

## 3. Register the application vocabulary

Create one vocabulary document when any selected concept declares an external
type or the application needs a concrete type. It has one nonempty H1, one
`types` fence, and may contain surrounding prose.

Declare each concrete type with a nonempty definition, then bind every selected
external parameter exactly once:

```types
concrete Person
  A stable identity supplied by the institution.

PostComments.User is Person
  Comment authors use institution identities.

PostComments.Target is Posting.Post
  Post comments attach to published posts.
```

The left side names a selected concept instance and one of its external
parameters. The right side directly names a concrete type or a type owned by a
selected concept instance. Do not create chains, bind to another external
parameter, or leave a concrete type unused.

The executable vocabulary module neither imports nor exports this Markdown.
Register it only through the generated config's `design.vocabulary` URL.

## 4. Explain application decisions with typed links

Create one or more ordinary Markdown documents with one nonempty H1. Organize
each around an application topic rather than around source directories or
checker categories. A document may explain declarations from several modules.

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

Put `computations` fences in any registered application document, including the
vocabulary document. Each executable computation needs exactly one declaration
with a nonempty indented body:

```computations
invitationMailText(invitation: String, credential: String) : String
  Produces the plain-text invitation containing the credential and sign-in URL.
```

Input names and optionality must match the executable registration. The result
is one bare type. Use an optional `computation:invitationMailText` link when
another passage refers to it. Do not put computations in concept
specifications.

## 6. Register explicit design URLs

Add a required versioned design block to the default export of
`generated.config.ts`:

```text
export default {
  assemble: assembleApplication,
  title: "Forum",
  design: {
    version: 1,
    vocabulary: new URL("./design/vocabulary.md", import.meta.url),
    documents: [
      new URL("./design/forum.md", import.meta.url),
      new URL("./design/access.md", import.meta.url),
    ],
  },
};
```

Every URL must use the local `file:` scheme. Relative URLs may point outside the
application directory, including elsewhere in a monorepo. Omit `vocabulary`
only when there are no selected external types and no concrete declarations.
Use this explicit empty form when there is no application-level declaration to
explain:

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
unresolvable concept source and TypeScript shapes, incomplete vocabulary,
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

The design checker establishes declaration shape, source provenance, vocabulary
closure, and exact coverage. It does not prove natural-language conditions,
effects, State semantics, computation semantics, persistence, transactions, or
runtime validation.

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
3. Preserve State in one raw fence; do not translate it into an invented SSF
   dialect.
4. Rewrite action branches and query result rows into the structured grammar.
5. Replace vocabulary edges and executable vocabulary Markdown imports with one
   configured vocabulary document using `concrete` and `is`.
6. Remove composition `spec` imports and add exact typed links to registered
   application prose.
7. Add declarations for every executable computation.
8. Add `design: { version: 1, vocabulary?, documents }` to each generated config.
9. Remove `--vocabulary-module`; run `sync-engine check` or pass `--config`.
10. Regenerate every manifest and generated artifact, then rerun tests.

There is no legacy parser, compatibility flag, automatic format detection, or
old-manifest decoder. Migration failures name the missing or malformed required
construct. Rollback requires restoring the old authored files, config, package,
and generated artifacts together.
