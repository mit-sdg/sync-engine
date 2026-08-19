# Run roles with Paseo

Paseo `--cwd` and assignment prose are not enforcement. Use provider or harness read and
write denial outside assigned application paths when available. The contract's path
discipline still binds every assignment.

The compiler owns every role launch:

```sh
bun "<skill-root>/scripts/command.ts" launch --role <role> --prompt <prompt-file>
```

It inspects the coordinator through `$PASEO_AGENT_ID`, reuses that exact provider, model
and reasoning setting, places the child in the application root, delivers the prompt as a
file, waits until the agent settles, attests what Paseo reports, and writes the launch
record that later prompt builds and the handback check require. Pass `--thinking` only
when the user names a setting. Never hand-roll `paseo run`: a role with no launch record
did not run.

Delegation is the default and every role is launched. Only an explicit repository
instruction forbidding subagents overrides it, and then stop and report; never take a
role yourself because launching looked unavailable.

Deliver a diagnostic follow-up to a role that already ran, using its record's `agentId`:

```sh
paseo send "$agent_id" --prompt-file "$follow_up_file" --no-wait
paseo wait "$agent_id" --timeout <seconds>
```

Delivery and synchronization are separate: every send uses `--no-wait`, followed by one
bounded wait for that follow-up. On timeout, collect one inspect/log snapshot and stop;
do not enter an inspect, log, permission, or wait polling loop.
