# Native-agent harness contract

The workflow requires a harness that can:

- create fresh native agents for independent roles;
- reuse the coordinator's exact provider and model with its normal reasoning setting at launch;
- constrain each role to its assigned application read/write paths and exclude framework
  source and installed package internals, rather than merely inspecting writes afterward;
- deliver initial and follow-up prompts from files without shell reinterpretation;
- run independent batches concurrently when requested; and
- wait for a specific agent with a bounded timeout.

If a required capability is unavailable, stop and name it. Do not simulate independent
criticism with coordinator self-review, embed generated Markdown in a shell command,
or silently use a higher reasoning setting.
