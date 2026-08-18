# @mit-sdg/sync-engine-skill

`@mit-sdg/sync-engine-skill` gives coding agents a compact, independently reviewed
workflow for designing and building sync-engine applications. It keeps authored
Markdown as design authority, separates concept and application implementation, and
requires independent objective evidence.

Roles are launched through [Paseo](https://paseo.dev), which is the only harness the
compiler drives today. Support for other harnesses is planned: each needs its own launch
module, and `references/harnesses/contract.md` states what one must provide. Everything
else — the prompt compiler, the brief and assignment checks, the design digest — is
harness-independent.

Install an exact published release into Pi, replacing `VERSION` with the desired beta:

```sh
pi install npm:@mit-sdg/sync-engine-skill@VERSION
```

For development from a checkout:

```sh
pi install /absolute/path/to/sync-engine/packages/skill
```

Pi discovers `skills/sync-engine/` in the package. Other Agent Skills loaders can point
directly to that directory. Do not also copy the same skill into a second discovery
location because duplicate names are ambiguous.

The skill is self-contained: its prompt compiler and brief validator are TypeScript
under `skills/sync-engine/scripts/` and require only Bun and platform APIs. A new
application does not install the skill package. The workflow instead reads
`release.json`, installs the exact matching core, catalog, and analysis releases into
the application, and rejects a mixed installed release set.

## Workflow

A normal run maintains a short `design/brief.md`, then performs:

```text
independent design → syntax → normal two-pass criticism
→ approval or autonomous preauthorized resolution → concept implementation
→ application implementation → independent evidence → required validation → handback
```

Criticism stops after the first clean pass. A second pass happens only after a material
repair. Interactive work needs an explicit “review more thoroughly” request for another
pass. Preauthorized work instead repairs a remaining safe/coherent-implementation
blocker autonomously while each pass makes progress, or records a nonblocking finding
as an open decision for handback. It never defers authority, non-bypassable
authorization, ownership, or brief-required behavior. Passing required checks hands
back immediately; optional polish and informational findings do not create another
cycle.

The default uses one concept worker and one application worker rather than repeating
role instructions for every concept and composition. A phase splits only for a prompt
budget or explicit user-requested parallelism. Implementation and evidence workers are
restricted to assigned application paths and supplied public references; they never
inspect framework source or installed package internals.

Start with [`skills/sync-engine/SKILL.md`](skills/sync-engine/SKILL.md). The coordinator
workflow and harness guides are linked there. Designer and critic prompts share one
small semantic design document; role templates declare their exact file inputs.

## Deterministic prompt commands

Resolve `<skill-root>` as the directory containing the loaded `SKILL.md`. For an empty
directory, read `release.json` and first write a minimal private module package whose
`packageManager` uses its exact Bun version. Do not run a Vite+ migration or choose
another package manager. After installing application dependencies and before setup,
verify their exact release and executable targets:

```sh
bun "<skill-root>/scripts/command.ts" release check .
bunx --no-install sync-engine setup
```

Setup supplies the supported TypeScript, Bun and Node declarations, standard scripts,
and concept-free configuration; do not probe or downgrade toolchain versions. Only after
setup succeeds, initialize and validate the compact product brief:

```sh
bun "<skill-root>/scripts/command.ts" brief init product/brief.md
# Fill the template.
bun "<skill-root>/scripts/command.ts" brief check product/brief.md
```

The brief is product authority the coordinator keeps editing, so it lives outside the
design root and `design digest` refuses a brief inside it: design identity covers only
role-owned design, while the brief is tracked separately in each prompt's context record.

`brief init` refuses to create a file before setup and prints the required bootstrap
commands. After independent review and authorization close, capture the authored design
identity:

```sh
bun "<skill-root>/scripts/command.ts" design digest design
```

Build a role prompt:

```sh
bun "<skill-root>/scripts/command.ts" prompt build \
  --role designer \
  --input brief=design/brief.md
```

The compiler names and writes the prompt under `.sync-engine/` in the application root
and reports the path. Generated prompts, follow-ups, assignments, and launch records all
live there; the compiler refuses to read a generated follow-up or assignment from
anywhere else, so nothing generated lands in `design/`, whose Markdown carries the design
identity. Nothing writes `.gitignore`: track the directory or ignore it as you prefer.

Concept, application, and evidence prompt builds also require `--design-root design`
and `--design-digest <sha256>`. Diagnostic follow-up files must pass `follow-up check`
with the same design identity and the 4 KiB limit.

Launch each role through the compiler rather than the harness CLI:

```sh
bun "<skill-root>/scripts/command.ts" launch --role designer --prompt <prompt-file>
```

`launch` drives Paseo today: it inspects the coordinator through `$PASEO_AGENT_ID`,
reuses that provider, model and reasoning setting, places the child in the application
root, delivers the prompt file, waits until the agent settles, and writes a launch
record. A role reasons like the coordinator unless `--thinking` names another setting. Building a role's prompt requires a settled record for the role before it, and
`handback check` requires one for every required role, still hashing to its prompt and
still known to the harness. A coordinator that quietly does a role itself therefore
cannot reach handback. Other harnesses need their own launch module.

The npm package also exposes `sync-engine-skill` as a convenience command, but the
workflow uses the bundled source path so copied skills and new applications bootstrap
without a package-local binary.

Templates support only static `include`, required `input`, and optional `input?`
Markdown directives. The compiler normalizes line endings and final newlines, orders
input files deterministically, enforces role budgets, binds downstream work to the
reviewed design digest, and reports sources, byte count, and SHA-256 outside prompt
bytes. Every command ends with `Next:` lines carrying the exact syntax of the commands
it leads to and the stage reference to read, with the design digest already interpolated.
It does not choose product decisions, workflow stages, approval, criticism, repair, or
acceptance; a `Next:` line is syntax, not permission.

Use file-based delivery in the agent harness. Generated Markdown must not be embedded
in a shell argument.

## Matching context tools

Use the unambiguous installed catalog command without downloads:

```sh
bunx --no-install sync-engine-catalog list
bunx --no-install sync-engine-catalog show concept/commenting --raw
```

`sync-engine-analysis` remains coordinator-only bounded context selection. Designer and
critic prompts never receive analysis output or instructions.
