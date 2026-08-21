# Antigravity native-agent adapter

Call `invoke_subagent` with the instruction printed by `launch prepare`, workspace
`inherit`, and the contract's shared configuration policy. The child starts with separate
context while editing the same application workspace. Wait once, within the prepared
launch deadline, for `Idle`;
never poll its transcript or state.

Use its conversation ID for `launch complete`. Send a follow-up to that same conversation
ID; an idle subagent wakes with its earlier context.

Antigravity retains native transcripts, but this compiler does not read them, so the
completed record has coordinator attestation and unavailable path audit.
