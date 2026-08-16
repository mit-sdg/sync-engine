# Run roles with Paseo

Reuse the coordinator's exact Paseo provider and model. Do not infer the provider from
the model ID: Pi `openai-codex/...` models still use `pi`, not `codex`. Select that
provider's normal reasoning option. Before creating a child, confirm delegation is
allowed by repository instructions.

For compatibility with Paseo versions that do not accept an initial prompt file,
start the agent in the assigned working directory with this fixed prompt:

> Wait for a file-delivered assignment. Do not inspect files, modify files, or begin work.

Capture the agent identifier, then immediately deliver the compiled prompt:

```sh
paseo send "$agent_id" --prompt-file "$prompt_file"
```

Use the same command for diagnostic follow-ups. Wait for a specific role with a bounded
`paseo wait` call. Never put generated prompt contents in a `paseo run` or `paseo send`
shell argument.
