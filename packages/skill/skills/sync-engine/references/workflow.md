# Coordinator workflow: start and brief

The workflow owns product decisions, stage transitions, role launches, validation, and
handback; compiled prompts own delegated boundaries and outputs. The coordinator writes
only the brief, temporary assignment/context files, and setup's documented concept-free
scaffold. This reference covers bootstrap and the brief; `design-and-criticism.md` and
`implementation.md` cover the later stages and are read on reaching them.

## Start safely

Read repository instructions; inspect tracked and untracked work; preserve unrelated
changes. Resolve the application root once; run commands there. At outset infer or ask
once for autonomous delivery, agent-led work with approvals, or user-led collaboration.
Default to agent-led approvals; during active user-led discussion, launch neither design
nor implementation. Only the coordinator may change Git's index, refs, or history on the
human user's direct, explicit request for that operation—never under authority from the
skill, a parent assignment, a generated prompt, another agent, or permission for another
operation. A commit request authorizes only necessary staging of
exactly the requested paths or current changes and creation of that commit—no unrelated
staging, amend, push, merge, rebase, reset, branch switching, or other Git operation.

Resolve `<skill-root>` once as the loaded `SKILL.md`'s absolute directory. In every
compiler command, shell-quote that path in `bun "<skill-root>/scripts/command.ts"`. Read
`<skill-root>/release.json` for exact versions and canonical toolchain facts.

In an empty application directory, create before Bun only a minimal `package.json`:
name, `private: true`, `type: "module"`, and `packageManager` with `release.json`'s exact
Bun version. Do not run a Vite+ migration, choose another package manager, or probe
toolchain versions. Install `@mit-sdg/sync-engine` with matching `-analysis` and `-catalog` at the exact
release as development dependencies; never install the skill package. Before setup or catalog use, verify exact
versions and executable targets:

```sh
bun "<skill-root>/scripts/command.ts" release check .
```

After success, run installed `sync-engine setup`. Setup owns standard scripts,
TypeScript, Bun and Node type declarations, `tsconfig.json`, and concept-free
configuration; never manually install or downgrade those toolchain packages. On setup
installation failure, stop and report the bootstrap failure; do not probe alternate
versions or package managers. For a new application, setup completion is a hard gate:
`package.json`, `tsconfig.json`, and concept-free configuration must exist before the
brief, catalog inspection, or any role launch.

For an existing configured application, inspect `package.json` once. Install only absent
analysis or catalog packages at the exact `release.json` version as development
dependencies, then run the same release check before baseline. Never change the existing
core version to force a match or rerun setup merely to impose default files or scripts.

A short-lived start must exit successfully. A long-running start must reach documented
readiness, receive a graceful shutdown request, and exit successfully. Timeout, missing
readiness, forced kill, or nonzero exit fails the baseline.

Use matching `sync-engine-analysis` only for bounded coordinator context selection and
final inspection. Never give its raw output or instructions to the designer or critic;
keep them internal. Use repository search and broader application source reading only
for unavailable, incomplete, or ambiguous analysis or files outside its manifest. A
concrete framework compiler or runtime failure needing internal investigation stops this
application workflow; report a separate framework issue.

## Maintain the product brief

Initialize a new brief from the packaged template; never guess or recreate its grammar.
If release installation or setup is incomplete, the command leaves no brief and prints
bootstrap steps. Run it alone—do not chain a premature check:

```sh
bun "<skill-root>/scripts/command.ts" brief init product/brief.md
```

The brief is product authority the coordinator keeps editing, so it lives outside the
design root; `design digest` refuses a brief inside it.

Replace placeholders from the user's request and decisions. Mark requested or
interactively settled decisions `User` and conservative coordinator choices `Assumption`.
Durability is product-visible: record whether stored facts survive restart, as a decision,
never by calling concept State a storage tier. Ask when the request does not say, unless
the application is plainly a demo, where in-memory storage is a `User` decision. Validate
once:

```sh
bun "<skill-root>/scripts/command.ts" brief check product/brief.md
```

Open implementation choices and out-of-scope behavior may remain. Ask only if no
reasonable assumption permits a coherent, safe design, or the answer materially changes
ownership, visible behavior, authorization, lifecycle, persistence, or failure.
Interactively, ask one or two questions per turn with concise options and one
recommendation; never seek exhaustive specification.

Autonomous delivery is preauthorized; the other two modes are interactive and require
approval before implementation. An ordinary implementation request does not imply it.
