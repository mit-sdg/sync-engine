# Operations room catalog bundle

This application coordinates an incident room from independent Gathering,
Selecting, Discussing, and Alerting concepts. Catalog recipes normalize a
selected mitigation, open its discussion, alert current members, enforce
membership on contributions, and form a joined dashboard.

Generate contracts, validate the installed source, and run the scenario:

```sh
bunx sync-engine artifacts pin
bunx sync-engine check --config generated.config.ts
bunx sync-engine artifacts check
bunx tsc --noEmit
bun src/scenario.ts
```

The catalog no longer owns copied files. Edit the concepts and composition to
fit the application; use `catalog diff` only when you want to compare them with
a catalog snapshot.
