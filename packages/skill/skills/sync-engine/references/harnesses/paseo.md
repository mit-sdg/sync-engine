# Paseo managed-launch adapter

Run the compiler-owned launch:

```sh
bun "<skill-root>/scripts/command.ts" launch --role <role> --prompt <prompt-file>
```

The adapter reads the coordinator from `$PASEO_AGENT_ID`, reuses its provider and model,
and applies its supported reasoning setting. Pass `--thinking` or `--model` only when the
user names an override. It places the child in the application root, sends the prompt
with `--prompt-file`, waits, captures the final response and tool log, and writes the
harness-attested record. Never substitute a hand-written `paseo run`.

For a checked diagnostic follow-up, use the record's `agentId`:

```sh
paseo send "$agent_id" --prompt-file "$follow_up_file" --no-wait
paseo wait "$agent_id" --timeout <seconds>
```

Paseo `--cwd` and assignment prose do not enforce path confinement. Use provider or
workspace denial when available; the record's tool audit reports observed reads and
repeated writes.
