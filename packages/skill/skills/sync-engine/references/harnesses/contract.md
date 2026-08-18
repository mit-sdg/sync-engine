# Native-agent harness contract

The workflow requires a harness that can:

- create fresh native agents for independent roles;
- expose the coordinator's exact provider and model, resolve that model's advertised
  normal reasoning setting, and attest those values on every role launch;
- give implementation and evidence roles narrow assigned application paths and, when
  available, enforce read and write denial outside them;
- deliver initial and follow-up prompts from files without shell reinterpretation;
- run independent batches concurrently when requested; and
- wait for a specific agent with a bounded timeout.

Filesystem confinement is best effort and is not a launch prerequisite. Regardless of
enforcement, role prompts must require agents to work only within their assigned
application paths and not read, write, inspect, search, or traverse outside them. Do not
transfer a role to the coordinator when enforcement is unavailable. Stop and name any
other missing required capability. Do not simulate independent criticism with coordinator
self-review or silently use a higher reasoning setting.
