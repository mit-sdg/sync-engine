# Codex native-agent adapter

Codex app, CLI and IDE sessions expose separate subagent threads. Spawn one fresh
`worker` (or the default general-purpose agent when `worker` is unavailable) with the
instruction printed by `launch prepare`. Do not select a custom agent configuration:
unconfigured subagents inherit the parent model, reasoning effort, sandbox and live
approval settings.

Use the spawned thread's agent ID for `launch complete` and that same thread for a
follow-up. Codex inherits the parent sandbox and approval settings, so do not launch from
a coordinator session looser than the role assignment.

Codex exposes thread activity in its agent UI but no interface this compiler queries, so
the completed record has coordinator attestation and unavailable path audit.
