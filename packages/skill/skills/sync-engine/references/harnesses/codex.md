# Codex native-agent adapter

Codex app, CLI and IDE sessions expose separate subagent threads. Spawn one fresh
`worker`, falling back to the default general-purpose agent, with the instruction printed
by `launch prepare` and the contract's shared configuration policy.

Use the spawned thread's agent ID for `launch complete` and that same thread for a
follow-up. Apply a stricter native profile when the surface offers one; otherwise the
prompt boundary is best effort
and completion records unavailable path/tool attestation.

Codex exposes thread activity in its agent UI but no interface this compiler queries, so
the completed record has coordinator attestation and unavailable path audit.
