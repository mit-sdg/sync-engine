# Run roles with Paseo

Paseo `--cwd` and assignment prose are not enforcement. Use provider or harness read and
write denial outside assigned application paths when available. The contract's path
discipline still binds every assignment.

Inspect the coordinator exactly once through `$PASEO_AGENT_ID`:

```sh
paseo inspect "$PASEO_AGENT_ID" --json
```

Resolve the absolute application root. If it differs from the inspected coordinator
`Cwd`, create one local application workspace and cache its returned workspace ID:

```sh
paseo workspace create --isolation local --path "$application_root" --json
```

Use `--workspace "$application_workspace_id"` on every role launch in place of
`--cwd "$PWD"`. An agent-scoped `--cwd` alone does not override the caller workspace.

Cache the coordinator's exact provider and model in active context. Do not infer the provider from the
model ID: Pi `openai-codex/...` models still use `pi`, not `codex`. When the user has
explicitly supplied descendant provider, model, and reasoning, use those values without
provider discovery. Do not pass `--mode` unless the user also supplied a mode that the
provider advertises; in particular, omit `--mode` for Pi when `AvailableModes` is empty.
The coordinator's displayed `Mode` is not a valid child option. Otherwise use provider
model discovery once to select that exact model's advertised normal reasoning option;
do not inherit coordinator elevation or guess an option ID.

Before creating a child, confirm delegation is allowed by repository instructions.
Launch every role without probing command help, using explicit cached values and this
exact shape (omit `--mode`):

```sh
paseo run --provider <provider> --model <model> --thinking <normal> --cwd "$PWD" \
  --background --json --title <role-title> \
  "Wait for a file-delivered assignment. Do not inspect files, modify files, or begin work."
```

Capture the child identifier. If launch output does not attest resolved parent,
provider, model, reasoning, and application working directory, inspect the child once.
Stop before assignment on a parent, provider, model, or reasoning mismatch. If only the
working directory is wrong, archive the unassigned child and retry once through the local
application workspace; do not ask the user to restart. Never launch implementation or
evidence roles in a sync-engine framework checkout.

Deliver initial and diagnostic files without blocking:

```sh
paseo send "$agent_id" --prompt-file "$prompt_file" --no-wait
paseo wait "$agent_id" --timeout <seconds>
```

Delivery and synchronization are separate: every send uses `--no-wait`, followed by one
bounded wait for that assignment. On timeout, collect one inspect/log snapshot and stop;
do not enter an inspect, log, permission, or wait polling loop.
