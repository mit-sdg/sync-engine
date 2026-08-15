# Coordinator workflow

This reference owns setup, stage transitions, user decisions, validation, and
handback. Role-specific prompt boundaries are in
[design roles](design-roles.md) and [implementation roles](implementation-roles.md).

## Establish a working baseline

Read the application's repository instructions and inspect ordinary files and the
current Git status without changing history. Inspect untracked files directly.
Do not begin design while setup or the baseline is broken, unless reproducing that
failure is the user's stated objective.

### New application

1. Confirm the target directory and product boundary. Create the directory only when
   needed, and initialize or reuse a Bun package; do not create a nested Git
   repository.
2. Read this skill package's exact version. If the Bun package does not declare
   `@mit-sdg/sync-engine`, install that same exact version with Bun. Refuse an
   incompatible existing declaration rather than replacing it silently.
3. Run the installed `sync-engine setup`. Let setup update the package manifest,
   install dependencies, and create only absent templates. Fix setup before moving
   on.
4. Run `bun run start` as a bounded smoke baseline. A short-lived start must exit
   successfully. For a long-running start, wait for its documented readiness signal,
   then request graceful shutdown and require a successful shutdown. A timeout,
   absent documented readiness condition, forced kill, or nonzero exit is not a
   passing baseline.

### Existing configured application

Do not rerun setup merely to impose default files or scripts. Read the package's
README and scripts, then run its existing documented baseline before design. Include
its start or smoke behavior when the objective can affect hosting. Apply the same
short-lived versus documented-readiness rule. Repair a broken baseline first unless
the objective is the failure.

Before broad application inspection, use the installed analysis command to prepare a
small inventory for coordinator context:

```sh
sync-engine-analysis summary
sync-engine-analysis search <objective terms> --limit 20
sync-engine-analysis describe <selected-ref>
```

Use focused queries and retain only the few references, relationships, and paths
needed for the current stage. This inventory is coordinator context only; do not send
analysis output to the designer or critic, and do not paste it into user-facing design
review. Analysis indicates manifest structure, possible impact, and source
attribution, not runtime proof.

Ordinary repository search and source reading is fallback only when analysis is
unavailable, explicitly incomplete or ambiguous, the target is outside the manifest
(such as package scripts, setup, or host files), or a concrete compiler/runtime
failure requires investigation. Keep fallback reading focused on the unresolved
question.

## Settle the product request

Ask no more than three questions before design. Ask only when an answer changes a
visible success, expected refusal, authority, lifecycle, persistence/deletion rule,
host interaction, or explicit non-goal. Do not ask for information already present.
Keep the resulting objective, decisions, non-goals, stage, and open issues in
coordinator context rather than an application file.

## Move from design to implementation

The coordinator may move forward only when all of these are true:

- the candidate contains `design/concepts/*.md`, `design/compositions/*.md`, and
  `design/types.md` as applicable;
- every concept file passes the core draft syntax command;
- a fresh read-only critic has completed its review;
- material findings have been repaired or explicitly surfaced;
- no more than two critic-driven repair passes were used; and
- the user clearly approved links to the current Markdown.

A simple application receives one design approval. Do not add a separate checkpoint
because registration, a thin host, or routine composition wiring is about to begin.
If a worker discovers a material contract decision, stop implementation, revise the
Markdown through the design protocol, show the changed design to the user, and obtain
renewed approval.

## Validate and hand back

After the evidence worker finishes, use bounded `sync-engine-analysis diagnostics`,
`sources`, and `impact` queries to select the declarations and relationships that
need final inspection. Do not treat those results as runtime proof or dump them in
the handback. Run focused validation and then every application-owned generation,
typecheck, check, test, and build command relevant to the change. Never hand-edit generated output. Inspect complete status and relevant
diffs after validation, including untracked files, and verify that approved Markdown
was not silently changed.

The final handback is concise and contains:

- implementation areas changed;
- an exact summary of validation commands and outcomes;
- known limits or remaining material uncertainty; and
- one request to accept, revise, or ask for more evidence.

Do not paste routine command transcripts. Expand failures enough to identify the
cause and next action. Acceptance closes the conversation only; it does not stage,
commit, tag, or otherwise operate on Git.
