# Native-agent harness contract

Read this before the matching harness guide. Paseo is the one harness the compiler
launches and inspects directly; other supported harnesses use coordinator-mediated
native delegation.

Every harness must create a fresh agent independent of the coordinator and earlier
roles, let it read the compiler-reported prompt file, route follow-ups to that same
agent, wait with a bounded timeout, and expose a stable agent or conversation ID. With
no override, it must preserve the coordinator's provider, model and reasoning setting
unless the user explicitly requested another.

Give every role only the tools its compiled prompt permits. Give implementation and
evidence roles narrow assigned application paths and, when available, enforce read and
write denial outside them. Filesystem confinement is best
effort and is not a launch prerequisite: role prompts must require agents not to read,
write, inspect, search or traverse outside assigned paths. Do not transfer a role to the
coordinator when enforcement is unavailable.

Delegation is the default. Only an explicit repository instruction forbidding subagents
overrides it; then stop instead of taking the role yourself. If fresh agents, identity,
follow-up routing or bounded waiting is missing, stop and name that capability. Never
substitute coordinator self-review for independent criticism.

## Managed launch

Paseo's guide uses one compiler command. The compiler launches and waits, observes the
effective configuration and state, captures the return and tool log, and writes a
harness-attested record.

## Native launch

Codex, Claude Code and Antigravity use this sequence:

1. Run `launch prepare --harness <harness> --role <role> --prompt <prompt-file>`.
2. Delegate with the harness tool as its guide specifies. Never run a nested headless
   CLI. Give only the reported instruction pointing to the prompt file, set no model or
   reasoning override, and wait.
3. Copy the final response verbatim into the reserved response file. This is
   administrative capture, not coordinator-authored role work.
4. Run `launch complete --ticket <ticket> --agent-id <native-agent-id>`.

Completion verifies ticket, prompt and response hashes and the response contract before
writing a coordinator-attested record. The compiler cannot query another harness's
in-session agent UI, so handback reports unavailable machine attestation; that UI or its
transcript remains the delegation evidence.

Send a compiler-built designer phase file or checked diagnostic follow-up by path to the
original agent and wait within the remaining deadline. A replacement lacks that role's context. On timeout, capture one
native status and stop; do not enter a status, permission, log or wait polling loop.
