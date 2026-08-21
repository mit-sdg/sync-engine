# Harness adapters

Paseo, Codex, Claude Code, Antigravity, and Cursor use one coordinator-mediated contract.
The prompt, capabilities, work-unit records, role independence, and continuation meaning
are the same in every harness. An adapter describes invocation differences; it does not
choose workflow phases or review outcomes. Pi may load and coordinate the skill, but Pi is
not itself an adapter; its environment must expose one of these mechanisms. Run
`sync-engine-skill --help` for exhaustive CLI options.

## Uniform launch flow

For every selected role or continuation:

1. The prompt builder writes the prompt file, effective capabilities, empty response file,
   and prepared record in the work unit. That record binds the selected harness, launch
   timeout, and any canonical design root. The adapter turns those facts into a launch
   request.
2. The coordinator invokes that harness's in-session agent mechanism from the application
   working directory. A fresh launch creates a fresh agent; a continuation targets the
   exact harness and agent identity recorded by the prior launch. Do not launch smoke-test
   agents, probe continuation, or reread adapter source before real work; adapter
   conformance is package-owned and the first bounded role launch is the useful test.
3. Deliver the prompt by file path. Do not paste or rewrite it. The shared capability
   support map is conservatively prompt-guided, so communicate every boundary in the
   prompt.
4. Use the coordinator's model and reasoning level unless the user requested another.
   `prompt build` and `continue` accept `--timeout <seconds>`; the record defaults it to
   1800 seconds. Observe through the harness's normal agent interface until terminal
   status or that limit. Harmless status checks are allowed; never resend the prompt. The
   skill CLI reports the limit but does not observe the harness.
5. Preserve the returned agent or conversation ID. The coordinator copies the final or
   partial response verbatim to the prepared response path as administrative capture.
   Keep capture files in the work unit; never use a shared temporary path such as `/tmp`.
   `completed` requires nonempty UTF-8; `failed`, `cancelled`, and `timed-out` may finalize
   an empty response.
6. Finalize the record from the application root with the harness's native terminal
   status:

   ```text
   sync-engine-skill launch complete <prepared-record> --agent-id <id>
     --status <native-status>
   ```

   Harness, timeout, and design root come from the prepared record; `launch complete`
   accepts no options for them. `--model <id>` may record an available native model value.
   The skill CLI validates the captured response and finalizes the record; it does not
   invoke the harness or obtain native output. The completed record stores the harness and
   agent identity, prompt and response paths, terminal status, effective capabilities,
   aggregate capability enforcement, and model detail when available.

The coordinator performs the one harness invocation. The skill core does not launch or
poll agents, inspect provider catalogs, or infer agent identity from coordinator
environment variables. Use only identities returned by launches in the current work unit;
do not list, inspect, read logs from, or reuse pre-existing agents to learn the harness.

## Continuation and replacement

Prepare a continuation with its phase, task, grant, and required repeated inputs:

```text
sync-engine-skill continue <finalized-record> --phase <phase> --task <path>
  --grant <json-path> --input <slot>=<path> [--input <slot>=<path>]...
  [--timeout <seconds>]
```

Invoke the same harness and exact same agent or conversation ID printed by the command.
Within the same phase, a continuation reuses or narrows capabilities; an explicit phase
transition validates the grant against the new phase maximum. An existing canonical
design binding is redigested automatically, and `--design-root` is then invalid. Use
`--design-root design` only to introduce a binding when the prior record has none. If a
harness cannot preserve identity, it cannot serve as a supported adapter.

When the original agent is unavailable, add `--replace`; retained inputs expand in full
for the fresh agent. Replacement mode may also select `--harness <harness>`. The new record
links to the replaced launch and identifies the fresh agent. Never label a replacement as
a continuation.

## Model and reasoning selection

Inheritance is the default. The adapter asks the harness to inherit the coordinator's
model and reasoning setting using that harness's supported representation. A
conversational user request may select a different model or reasoning level for a role.
The adapter passes that request through and reports when the harness cannot represent it.
The skill core does not query model catalogs or require a provider-specific equality
check.

Record model details only when the harness makes them available. Their availability does
not change the workflow meaning of a completed role.

## Capability application

The skill uses one conservative support map for repository reads, owned-path writes,
project-local shell access, network access, generated-output commands, and long-running
processes. Every category is currently **prompt-guided**, and each completed record stores
that aggregate enforcement level.

Prompt guidance is not a machine-applied restriction. None of the supplied adapters
treats workspace placement as read or write confinement. This is a warning and a fact for
handback, not a reason to move delegated work into the coordinator. A grant that exceeds
the role maximum is invalid regardless of harness support.

## Invocation differences

Only the following adapter details vary:

| Harness     | Fresh launch                                                                                                           | Stable continuation                                                                        | Workspace detail                                                                                                            |
| ----------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| Paseo       | Launch with one short prompt telling the agent to read the generated prompt path; Paseo has no prompt-file CLI option. | Send the same kind of file-reading instruction to the returned Paseo agent ID.             | Set the application root as the agent working directory.                                                                    |
| Codex       | Spawn a fresh `worker` thread; use the general-purpose agent when `worker` is unavailable.                             | Resume the same returned thread or agent ID.                                               | Use the application root shared by the active Codex session.                                                                |
| Claude Code | Invoke a fresh `general-purpose` agent with the `Agent` tool.                                                          | Resume the returned agent ID.                                                              | Keep worktree isolation off so sequential roles share the application workspace.                                            |
| Antigravity | Call `invoke_subagent` with workspace `inherit`; wait for `Idle`.                                                      | Send the continuation to the same conversation ID.                                         | Inherit the application workspace.                                                                                          |
| Cursor      | Run `cursor-agent --print --output-format json` with the prompt-file instruction and capture `session_id`.             | Run the same command with `--resume <session_id>` and verify the returned ID is unchanged. | Pass the application root with `--workspace`; use `--model` when the coordinator supplies a model or the user requests one. |

Fresh launches use separate conversational context while operating on the same
application files. Implementation roles do not inherit one another's conversations.

## Harness and provider failures

A wait or harmless status inspection may be retried, but never resend a role prompt
automatically after an agent, harness, or provider error. The coordinator copies the
available response and terminal status for validation and finalization, then chooses one
recovery: continue the same agent, launch an explicit replacement, or stop.

Reject a launch before role work when the adapter cannot provide fresh-agent launch,
stable same-agent continuation, prompt-file delivery, the application working directory,
effective capability representation, or status and response capture. The same adapter
conformance checks apply to every supplied harness.
