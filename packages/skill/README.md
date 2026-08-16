# @mit-sdg/sync-engine-skill

`@mit-sdg/sync-engine-skill` gives coding agents a compact, independently reviewed
workflow for designing and building sync-engine applications. It keeps authored
Markdown as design authority, separates concept and application implementation, and
requires independent objective evidence.

Install the exact beta and expose its skill directory to your Agent Skills loader:

```sh
bun add --dev --exact @mit-sdg/sync-engine-skill@beta
```

```text
node_modules/@mit-sdg/sync-engine-skill/skills/sync-engine
```

The package pins the exact matching core, catalog, and analysis releases. Its commands
reject a mixed installed release set.

## Workflow

A normal run maintains a short `design/brief.md`, then performs:

```text
independent design → syntax → up to two necessary critic passes
→ approval or explicit preauthorization → concept implementation
→ application implementation → independent evidence → required validation → handback
```

Criticism stops after the first clean pass. A second pass happens only after a material
repair. Further review requires an explicit “review more thoroughly” request. Passing
required checks hands back immediately; optional polish and informational findings do
not create another cycle.

The default uses one concept worker and one application worker rather than repeating
role instructions for every concept and composition. A phase splits only for a prompt
budget or explicit user-requested parallelism.

Start with [`skills/sync-engine/SKILL.md`](skills/sync-engine/SKILL.md). The coordinator
workflow and harness guides are linked there. Designer and critic prompts share one
small semantic design document; role templates declare their exact file inputs.

## Deterministic prompt commands

Validate the compact product brief:

```sh
bunx --no-install sync-engine-skill brief check design/brief.md
```

Build a role prompt directly to a file:

```sh
bunx --no-install sync-engine-skill prompt build \
  --role designer \
  --input brief=design/brief.md \
  --output /tmp/designer.prompt.md
```

Templates support only static `include`, required `input`, and optional `input?`
Markdown directives. The compiler normalizes line endings and final newlines, orders
input files deterministically, enforces role budgets, and reports sources, byte count,
and SHA-256 outside prompt bytes. It does not choose product decisions, workflow
stages, approval, criticism, repair, or acceptance.

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
