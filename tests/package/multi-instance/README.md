# Packed multi-instance compatibility fixture

This fixture is copied out of the repository and run by `bun run package:check`
on every package-check CI platform with Node 24. It is deliberately not part of
the repository TypeScript project: both packages install and typecheck against
packed declarations in their own directories.

## Package flow

1. Pack and install `@mit-sdg/sync-engine` into `client/`.
2. Run that installed `sync-engine` command to generate the logical and
   production-HTTP wire in `client/src/generated/wire.ts`.
3. Compile declarations and JavaScript, then pack
   `@sync-engine-fixture/multi-instance-client`.
4. Install both tarballs into `backend/`, compile the backend from the installed
   declarations, and execute `dist/scenario.js` with Node 24.

The backend imports generated contracts and the client factory only through
`@sync-engine-fixture/multi-instance-client`; it never reaches into the client
package's source tree.

## Executed contract

The scenario opens two `node:sqlite` `DatabaseSync` connections to one real
temporary file. Two concept floors supply separate concept objects, controlled
schedulers, application `MemoryStore`s, observers, and resource descriptors to
two independent assemblies and gateway decorators.

It deterministically asserts that:

- held action bodies overlap across the two assemblies, while a SQLite unique
  constraint makes each same-name contest return one success and one registered
  public `CONFLICT`;
- reactions and occurrence records remain local to the instance and store that
  executed them, while gateway settlement events retain correlation;
- a durable domain `operationId` returns one stable persisted result when a
  retry uses another instance and correlation id;
- one correlation id with two operation ids creates two durable records;
- idempotent domain state does not make the surrounding successful-action
  reaction exactly-once;
- a caller timeout stops waiting while accepted work continues and commits;
- drain rejects gateway and application roots and waits for that actual work;
- active flows can temporarily exceed a retention window, which is bounded
  again after settlement;
- a later unregistered fault does not roll back an earlier committed action;
- pre-existing durable state produces no occurrence, reaction, or restart
  replay when the assemblies start;
- the host invokes every `conceptFloor.close()` explicitly and every SQLite and
  scheduler resource closes exactly once.

The same-name contest runs four controlled rounds. Promise gates establish the
overlap and choose release order; correctness does not depend on timer races.
SQLite uses explicit transactions and schema constraints, with no third-party
database dependency. Scenario waits and the parent Node process both have hard
deadlines, and cleanup runs from `finally`.
