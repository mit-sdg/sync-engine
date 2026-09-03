# Harness execution

Use this reference only when delegating. Coordinator simulation does not invoke a harness.

## Common launch contract

The selected harness creates and retains the role agent through completion. Run `sync-engine-skill harness recommend` before delegation. A detected supervising harness takes precedence over its embedded provider runtime. Use the printed launch action from prompt preparation. Paseo-managed shells expose connection and agent IDs, but currently expose no provider, model, or thinking setting. Supply `--provider` and `--model` to a fresh `launch paseo` command. Supply `--thinking` when required. `PASEO_PROVIDER`, `PASEO_MODEL`, and `PASEO_THINKING` are accepted when a future or configured environment exposes them.

For each delegated run:

1. Build the role prompt. The CLI writes task, access, prompt, empty response, and prepared record artifacts.
2. Invoke the printed launch action from the application workspace. A fresh run creates a fresh identity. A continuation targets the exact recorded identity.
3. Send only the printed short instruction: `Read and follow the complete assignment in <prompt-path>`. The prompt file is the complete role message. Do not paste, summarize, or prefix its contents.
4. For Paseo, run `launch paseo` once. It starts or continues the child in the background, records the identity, and performs one short wait slice.
5. Repeat the exact printed `launch wait` command while the status is running. Each call is short by design. Never resend the assignment.
6. An idle Paseo wait captures `paseo logs <id> --filter text --tail 1` verbatim. It infers blocked versus completed and runs completion by default. Use `--no-complete` only for manual completion.
7. For another harness, observe through its native mechanism. Copy its final response verbatim to the response path. Run the printed `launch complete` command.
8. Use `--status blocked` when the required Status or Verdict says blocked. Completion validates adapter-specific identity form.

If a fresh launch has not started and must use another adapter, run `sync-engine-skill launch adapter <prepared-record> --harness <harness>` before launching. A same-agent continuation cannot change adapter.

The explicitly named prompt file is the only workflow artifact the role may read. The compiled prompt contains its task, context, access, and result guidance.

A harmless status check may be repeated. Retry a fresh launch only when no identity was created and the prompt was not accepted. Otherwise preserve the attempt and choose a continuation, fresh replacement, simulation, or stop. Never end the turn while a record is prepared. If the harness ends the turn during a Paseo wait loop, resume by running `launch wait` again.

## Continuation

`sync-engine-skill continue` targets the recorded harness and identity. Same-phase continuation sends a compact file-backed delta. A phase transition sends the complete new role prompt. Replacement creates a fresh identity and may change harness.

A simulated run has no identity and cannot be continued as an agent. `sync-engine-skill continue` nevertheless builds a compact, file-backed simulation continuation for the coordinator; it records no harness identity.

## Capability warning

All supplied adapters currently communicate access through prompt guidance. Workspace placement is not read/write confinement. Declared access remains useful for interpretation and audit, but not as a sandbox guarantee.

## Adapter differences

| Adapter     | Fresh identity                             | Continuation                      | Workspace                                               |
| ----------- | ------------------------------------------ | --------------------------------- | ------------------------------------------------------- |
| Paseo       | background `paseo run`; record agent ID    | no-wait `paseo send` to that ID   | Set application root as `cwd`                           |
| Pi          | persistent JSON session; capture header ID | reopen the same session ID        | Application root; session directory under the work item |
| Codex       | fresh worker thread                        | resume returned thread ID         | Inherit application workspace                           |
| Claude Code | fresh general-purpose Agent                | resume returned agent ID          | Inherit workspace; no worktree isolation                |
| Antigravity | fresh inherited-workspace subagent         | continue returned conversation ID | Inherit application workspace                           |
| Cursor      | fresh CLI session; capture `session_id`    | `--resume` the same ID            | Pass application root with `--workspace`                |

Model and reasoning inherit from the coordinator unless the user requests a role-specific override. Report when an adapter cannot represent the request.
