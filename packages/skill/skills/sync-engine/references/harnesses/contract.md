# Native-agent harness contract

The workflow requires a harness that can:

- create fresh native agents for independent roles;
- select or confirm the provider's normal reasoning setting at launch;
- assign a working directory and inspect returned changes against read/write bounds;
- deliver initial and follow-up prompts from files without shell reinterpretation;
- run independent batches concurrently when requested; and
- wait for a specific agent with a bounded timeout.

If a required capability is unavailable, stop and name it. Do not simulate independent
criticism with coordinator self-review, embed generated Markdown in a shell command,
or silently use a higher reasoning setting.
