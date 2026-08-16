# Run roles with Paseo

A Paseo working directory and assignment prose are not read confinement. Before any
implementation or evidence role, verify that the selected provider or harness actually
denies reads outside the assignment's allowed application paths, including framework
source, installed package internals, source maps, and traced imports. If it cannot, stop
and name the missing harness capability; post-hoc write inspection is not a substitute.

Inspect the coordinator exactly once through `$PASEO_AGENT_ID`:

```sh
paseo inspect "$PASEO_AGENT_ID" --json
```

Cache its exact provider and model in active context. Do not infer the provider from the
model ID: Pi `openai-codex/...` models still use `pi`, not `codex`. When the user has
explicitly supplied descendant provider, model, and reasoning, use those values without
provider discovery. Otherwise use provider model discovery once to select that exact
model's advertised normal reasoning option; do not inherit coordinator elevation or
guess an option ID.

Before creating a child, confirm delegation is allowed by repository instructions.
Launch every role in the application workspace with explicit cached provider, model,
normal reasoning, background mode, JSON output, and this fixed prompt:

> Wait for a file-delivered assignment. Do not inspect files, modify files, or begin work.

Capture the child identifier. If launch output does not attest resolved parent,
provider, model, reasoning, and working directory, inspect the child once. Stop before
assignment on any mismatch. Never launch implementation roles in a sync-engine
framework checkout.

Deliver initial and diagnostic files without blocking:

```sh
paseo send "$agent_id" --prompt-file "$prompt_file" --no-wait
paseo wait "$agent_id" --timeout <seconds>
```

Delivery and synchronization are separate: every send uses `--no-wait`, followed by one
bounded wait for that assignment. On timeout, collect one inspect/log snapshot and stop;
do not enter an inspect, log, permission, or wait polling loop. Never put generated
prompt contents in a `paseo run` or `paseo send` shell argument.
