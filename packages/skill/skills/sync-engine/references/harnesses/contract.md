# Agent-harness contract

Read this before one adapter. Paseo is the one harness the compiler launches and inspects
directly; other supported harnesses use coordinator-mediated native delegation.

Every initial role is fresh and independent. A later phase or follow-up returns to the
recorded agent in the same harness. Give it the compiler-reported prompt file, use a
bounded wait, and retain its stable agent or conversation ID. With no model override,
request inheritance of provider, model, reasoning, permissions, and workspace. Set only a
field the user names; native records call configuration coordinator-attested, never
machine-observed.

Apply the compiled tool policy when the native launcher exposes tool selection; otherwise
it is prompt-enforced and the record must not claim tool attestation. A critic may read
its prompt file, then uses no tools. Give workers narrow assigned paths and enforce denial
when available. Filesystem confinement is best effort and is not a launch prerequisite:
role prompts must require agents to avoid access outside assigned paths. Do not transfer a role to the
coordinator when enforcement is unavailable.

Delegation is the default. Only an explicit repository instruction forbidding subagents
overrides it; then stop rather than taking the role yourself. Missing fresh agents,
identity, follow-up routing, or bounded waiting is a capability blocker. Never substitute
coordinator self-review for independent criticism.

## Managed launch

Paseo's adapter uses one compiler command. The compiler launches and waits, observes
configuration and state, captures response and tools, and writes a harness-attested
record.

## Native launch

Codex, Claude Code and Antigravity use this sequence:

1. Run `launch prepare --harness <harness> --role <role> --prompt <prompt-file>`.
2. Delegate with the native tool. Never run a nested headless CLI. Give only the printed
   prompt-file instruction, apply the configuration policy above, and wait.
3. Copy the final response verbatim into the reserved response file. This is
   administrative capture, not coordinator-authored role work.
4. Run `launch complete --ticket <ticket> --agent-id <native-agent-id>`.

Completion verifies ticket, prompt, response, and context hashes before writing a
coordinator-attested record. The compiler cannot query the native agent UI, so handback
reports unavailable machine attestation; the UI or transcript remains evidence.

Prepare each designer phase separately. Pass `--continue-agent <map-designer-id>` for the
contract phase and use that exact agent in the same harness. Under direct human
`--user-override`, a self-contained contract prompt may launch fresh. Send a checked
follow-up by path to the original agent and wait within the remaining deadline. On
timeout, capture one native status and stop; do not enter a status, permission, log or wait
polling loop.
