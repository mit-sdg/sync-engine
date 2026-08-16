# Native-agent harness contract

The workflow requires a harness that can:

- create fresh native agents for independent roles;
- expose the coordinator's exact provider and model, resolve that model's advertised
  normal reasoning setting, and attest those values on every role launch;
- enforce read and write denial outside each role's assigned application paths and exclude
  framework source and installed package internals; assignment prose, a working directory,
  and post-hoc write inspection are not confinement;
- deliver initial and follow-up prompts from files without shell reinterpretation;
- run independent batches concurrently when requested; and
- wait for a specific agent with a bounded timeout.

If a required capability is unavailable, stop and name it. Do not simulate independent
criticism with coordinator self-review, embed generated Markdown in a shell command,
or silently use a higher reasoning setting.
