Use only this prompt and assigned read/write paths; run only its listed commands. Do not
search directories, use Git/network, install, or inspect an unlisted file. Respect all
budgets. After one informed repair, if the same diagnostic signature recurs, stop.
Missing material is a context blocker; never expand your own scope. Return exactly:

```text
Changed:
- path or none
Checks:
- command/outcome or evidence
Blocker: none or precise blocker
Budget: <tool calls used>/<max>; commands <runs>; repairs <signatures>; follow-ups <used>/<max>
```
