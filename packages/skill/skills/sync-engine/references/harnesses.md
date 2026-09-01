# Harness execution

Use this reference only when delegating. Coordinator simulation does not invoke a harness.

## Common launch contract

The selected harness is the mechanism that creates and retains the role agent through completion. Run `sync-engine-skill harness recommend` before delegation; a detected supervising harness takes precedence over its embedded provider runtime. For Paseo-managed coordinators, inspect the current agent and pass its provider, model, and thinking settings to the foreground `paseo run`. Use the printed launch action from prompt preparation.

For each delegated run:

1. Build the role prompt. The CLI writes task, access, prompt, empty response, and prepared record artifacts.
2. Invoke the selected harness from the application workspace. A fresh run creates a fresh identity; a continuation targets the exact recorded identity. Keep Paseo launches in the foreground so the coordinator receives the final response before continuing.
3. Send only the printed short instruction: `Read and follow the complete assignment in <prompt-path>`. The prompt file is the complete role message. Do not paste, summarize, or prefix its contents.
4. Observe until terminal status or the recorded timeout. Preserve the returned identity and complete final or partial response.
5. Copy the response verbatim to the printed response path and run the printed `launch complete` command before preparing another role. Completion validates adapter-specific identity form.

If a fresh launch has not started and must use another adapter, run `sync-engine-skill launch adapter <prepared-record> --harness <harness>` before launching. A same-agent continuation cannot change adapter.

The explicitly named prompt file is the only workflow artifact the role may read. The compiled prompt contains its task, context, access, and result guidance.

A harmless status check may be repeated. Retry a fresh launch only when no identity was created and the prompt was not accepted. Otherwise preserve the attempt and choose a continuation, fresh replacement, simulation, or stop.

## Continuation

`sync-engine-skill continue` targets the recorded harness and identity. Same-phase continuation sends a compact file-backed delta. A phase transition sends the complete new role prompt. Replacement creates a fresh identity and may change harness.

A simulated run has no identity and cannot be continued as an agent. Prepare another simulation or a fresh delegated run instead.

## Capability warning

All supplied adapters currently communicate access through prompt guidance. Workspace placement is not read/write confinement. Declared access remains useful for interpretation and audit, but not as a sandbox guarantee.

## Adapter differences

| Adapter     | Fresh identity                             | Continuation                      | Workspace                                               |
| ----------- | ------------------------------------------ | --------------------------------- | ------------------------------------------------------- |
| Paseo       | `paseo run`; capture agent ID              | `paseo send` to that ID           | Set application root as `cwd`                           |
| Pi          | persistent JSON session; capture header ID | reopen the same session ID        | Application root; session directory under the work item |
| Codex       | fresh worker thread                        | resume returned thread ID         | Inherit application workspace                           |
| Claude Code | fresh general-purpose Agent                | resume returned agent ID          | Inherit workspace; no worktree isolation                |
| Antigravity | fresh inherited-workspace subagent         | continue returned conversation ID | Inherit application workspace                           |
| Cursor      | fresh CLI session; capture `session_id`    | `--resume` the same ID            | Pass application root with `--workspace`                |

Model and reasoning inherit from the coordinator unless the user requests a role-specific override. Report when an adapter cannot represent the request.
