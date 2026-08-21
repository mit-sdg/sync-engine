# Claude Code native-agent adapter

Invoke one fresh `general-purpose` agent through Claude Code's `Agent` tool with the
instruction printed by `launch prepare` and the contract's shared configuration policy.
Do not enable worktree isolation: sequential role changes must remain in the application
workspace read by the next stage.

Use the returned agent ID for `launch complete` and resume that same ID for a follow-up.
Claude Code can expose stronger evidence through `SubagentStart`, `SubagentStop` and tool
hooks, but this workflow installs no project hooks; the completed record therefore has
coordinator attestation and unavailable path audit.
