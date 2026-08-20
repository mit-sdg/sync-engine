# Claude Code native-agent adapter

Invoke one fresh `general-purpose` agent through Claude Code's `Agent` tool with the
instruction printed by `launch prepare`. Omit `model`, `effort` and `isolation`: the
subagent then inherits the conversation's model and extended-thinking configuration and
works in the current workspace. Worktree isolation would place sequential role changes
outside the workspace read by the next stage.

Use the returned agent ID for `launch complete` and resume that same ID for a follow-up.
Claude Code can expose stronger evidence through `SubagentStart`, `SubagentStop` and tool
hooks, but this workflow installs no project hooks; the completed record therefore has
coordinator attestation and unavailable path audit.
