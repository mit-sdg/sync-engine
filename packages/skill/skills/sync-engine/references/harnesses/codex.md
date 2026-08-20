# Codex native-agent adapter

Codex app, CLI and IDE sessions expose separate subagent threads. Spawn one fresh
`worker` (or the default general-purpose agent when `worker` is unavailable) with the
instruction printed by `launch prepare`. Leave agent configuration unset for inheritance;
unconfigured subagents inherit the parent model, reasoning effort, sandbox and live
approval settings. For an override authorized by the contract, set only the matching
native model or reasoning field; if this Codex surface exposes no such field, stop and
name that capability.

Use the spawned thread's agent ID for `launch complete` and that same thread for a
follow-up. Codex inherits the parent sandbox and approval settings. Apply a stricter
native profile when the surface offers one; otherwise the prompt boundary is best effort
and completion records unavailable path/tool attestation.

Codex exposes thread activity in its agent UI but no interface this compiler queries, so
the completed record has coordinator attestation and unavailable path audit.
