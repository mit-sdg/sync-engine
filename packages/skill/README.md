# @mit-sdg/sync-engine-skill

An Agent Skill that runs one coding agent through designing and building a sync-engine
application. The agent that loads the skill becomes a coordinator. It writes the product
brief and the role assignments, and delegates every other piece of work to a separate
agent it launches.

The point of the split is independence. The agent that designs has not seen the
implementation. The agent that reviews the design has not written it. The agent that
gathers evidence did not build the thing it tests. The skill is built so the coordinator
cannot quietly skip any of that.

## Install

```sh
pi install npm:@mit-sdg/sync-engine-skill@VERSION
```

From a checkout, point the loader at `skills/sync-engine/` instead. Install it once. Two
copies under the same name are ambiguous.

Applications do not depend on this package. The skill reads `release.json` and installs
the matching engine, catalog, and analysis releases into the application, then refuses to
continue if the installed versions disagree.

## A run

```text
brief -> design -> syntax -> criticism -> approval
      -> concept implementation -> application implementation
      -> evidence -> validation -> handback
```

The coordinator keeps `product/brief.md`, which records what the product does and which
decisions were the user's rather than its own. Everything under `design/` is written by
the designer and is read-only to everyone downstream.

Criticism runs until a pass is clean. Repairs go back to the agent that produced the work,
as a short follow-up file, never as a fresh copy of the whole prompt.

One concept worker implements all concepts. One application worker wires them together.
Splitting either one happens only when a prompt exceeds its budget or the user asks for it.

## What the skill enforces

Prompts, assignments, follow-ups, launch records, and captured replies are written by the
compiler under `.sync-engine/` in the application root, with names it chooses. The
coordinator has no clock and no reason to invent a filename, so it does not get to.

Every role is started by `launch`, not by the harness CLI. `launch` reads the
coordinator's own provider, model, and reasoning setting and gives the child the same
ones, puts it in the application root, hands over the prompt as a file, and waits. It then
writes a launch record holding the agent id, the prompt hash and size, the brief hash, the
design digest, and the times. Building the next role's prompt requires a settled record
for the role before it. `handback check` requires one for every required role: designer,
critic, concept worker, application worker, evidence worker. A coordinator that does a
role itself has no record for it and cannot reach handback.

After a role settles, `launch` reads two things from the harness rather than from the
agent:

- Its last message, checked against what the role was told to return. A critic must give
  the clean sentence or its findings, with nothing wrapped around them. A worker must
  report changed paths and check outcomes. A reply that does not match means the role does
  not count.
- The paths it opened. A designer or critic works from its prompt alone. An implementation
  worker may also read the installed engine's `examples/` and `docs/user/`, and nothing
  else inside it. No role reads the skill's own sources. When a harness names its tools
  without their arguments, the record says the audit was unavailable rather than claiming
  the role was clean.

`design digest` hashes the authored design. Downstream prompts carry that digest, and a
role launched against a different one stops counting, so reopening design after
implementation means relaunching the roles under it instead of deciding for yourself that
the earlier work still holds.

`assignment check` reads the write-path section of an assignment and refuses one that
hands a role another role's files, gives a concept worker application-wide commands or no
focused type check, or states no storage guarantee.

A role that ends in an error is inspected again after a pause, in case the error was a
dropped connection rather than the role failing. If it persists, the role is asked to
continue, at most twice, before the launch fails.

## Commands

```text
release check [<application-directory>]
brief init <brief.md>
brief check <brief.md>
design digest <design-directory>
prompt build --role <role> --input <slot>=<path>...
assignment new --role <role> --design-digest <sha256>
assignment check <file>
follow-up new --role <role>
follow-up check <file> --design-root <directory> --design-digest <sha256>
launch --role <role> --prompt <path> [--timeout <seconds>]
handback check --design-root <directory> --design-digest <sha256>
```

Run them as `bun "<skill-root>/scripts/command.ts" <command>`, where `<skill-root>` is the
directory holding the loaded `SKILL.md`. Every command ends with `Next:` lines giving the
exact syntax of what follows and which reference to read. Those lines are syntax, not
permission: the compiler does not decide product questions, approval, or when a stage is
finished.

Prompt templates support three directives: `include` for shared text, `input` for a
required file, and `input?` for an optional one. The compiler enforces a byte budget per
role, orders inputs the same way every time, and reports sources, size, and hash
separately from the prompt itself.

Deliver generated Markdown as a file. It does not belong in a shell argument.

## Harnesses

`launch` drives [Paseo](https://paseo.dev) today. Everything else, including the compiler,
the checks, and the design digest, works anywhere. Another harness needs its own launch
module; `references/harnesses/contract.md` states what it has to provide.

## Reading order

Start at [`skills/sync-engine/SKILL.md`](skills/sync-engine/SKILL.md). It links the
coordinator workflow and the stage references. Role prompts declare their own inputs, so
the compiler assembles them and nobody needs to read the templates.
