# Account Center

Account Center is a self-contained profile-backed account application built from
three independent concepts:

- Profiling owns one display profile for each opaque external principal.
- Preferring owns ordered `scope`/`key`/`value` preferences for a profile.
- Notifying owns an ordered in-app inbox with read and dismissed state.

The account-center composition exposes profile, preference, trusted inbox-
delivery, read, dismiss, and joined-account endpoints. Runtime and toolchain
requirements are declared in `package.json` and the repository
[support policy](../../SUPPORT.md). This is a complete runnable example, not a
production authentication or authorization system.

## Run the example

Run these commands from this directory:

```sh
bun install
bun run check
bun run start
```

The asserting scenario creates and renames Avery's profile, keeps ordered theme
and digest preferences, delivers two ordered notifications, checks wrong-owner
and unknown-profile refusals, marks one notification read, clears one
preference, dismisses the inbox, and prints a stable summary. Concept and recipe
evidence run as part of `bun run test`.

## Identity boundary

The endpoint fields `principal`, `profile`, and notification `recipient` are
caller claims until a trusted adapter binds them. `createGateway` does not
authenticate requests or decide which account a caller may use.

At the HTTP, RPC, or worker adapter in front of the gateway:

1. Verify the session, token, or service credential using the deployment's
   authentication system.
2. Derive the opaque principal from that verified identity. Overwrite, rather
   than trust, the body's `principal` for account creation and reads.
3. Resolve the principal's profile in trusted storage. Overwrite `profile` for
   rename, preference, read, and dismiss operations, and reject access when the
   resolved owner does not match.
4. Treat `/account/notifications/deliver` as a trusted service operation. Bind
   its `profile` from authorized application context instead of accepting an
   arbitrary profile from an untrusted caller.

Keep credentials and identity-provider data outside these concepts. Store only
the opaque principal needed to associate an authenticated identity with its
application profile. Add authorization policy in the trusted adapter or a
dedicated composition; display-name ownership is not authorization.

## Persistence boundary

The included implementations keep state in memory, so process restart loses
profiles, preferences, and notifications. `assembleAccountCenter` and
`buildAccountCenter` accept `AccountCenterOverrides`, allowing the application
to inject structurally compatible implementations for `Profiling`,
`Preferring`, and `Notifying`.

For durable deployment, replace or adapt the local implementations around a
database or repository and pass those instances to the assembly. Preserve the
registered action/query shapes and registered refusal error classes. Storage
operations should enforce principal uniqueness atomically, preserve first-set
preference order, and retain notification order and read/dismiss state under
concurrent requests. Use migrations, transactions, indexes, and deployment-
owned ID generation appropriate to the datastore; do not treat an occasional
dump of the in-memory maps as durable storage.

Preferring and Notifying need application-owned durable implementations, as
does Profiling. Exercise the scenario and concept conformance evidence against
every replacement before deploying it.

## Delivery boundary

`/account/notifications/deliver` and `Notifying.deliver` both create an inbox
item unconditionally for the supplied profile. Keep both behind trusted
application composition. Preferences do not enforce delivery policy by
themselves: enforce channel or topic choices in the state owner that can make
the delivery decision atomically, or in a deployment service with equivalent
transactional guarantees. Do not rely on separately evaluated mutable guards
as a security or exactly-once boundary.

Notifying records an in-app inbox item. It does not send email or push messages,
confirm provider delivery, deduplicate retries, or provide exactly-once
semantics. Model external dispatch, idempotency keys, retries, and provider
receipts in a separate delivery/outbox concept and compose it with the
preference check. A retried accepted request can otherwise create another inbox
item.

## Validation and limits

Endpoints validate exact object keys and bounded strings at runtime. Principals,
profile IDs, scopes, keys, topics, and notification IDs are limited to 128
characters; subjects to 256; preference values and messages to 4,096. Joined-
account output is also validated, including every preference and inbox row.

The generated application diagnostic check reports conservative missing-
fallback advisories for action/refusal chains and an order-sensitive-former
advisory for the intentional preference and inbox order. Keep reviewing those
advisories after changing actions or guards; the scenario covers the shipped
branches but does not prove arbitrary replacement implementations or concurrent
adapter behavior.

The assembly configures these conservative limits:

- 100 active root flows and 100 pending requests;
- 100 actions and 100 reaction firings per flow;
- 1,000 rows per read evaluation;
- 5,000 milliseconds per request.

These are resource guards, not identity checks, authorization, rate limits, or
tenant quotas. Monitor real workloads and adjust them deliberately. Keep the
row limit in mind when allowing unbounded preference or inbox growth.

## Extend the contracts

Change a concept specification, implementation, and registry together, then
update the composition and runtime validators that expose the changed data.

- For profile fields, update Profiling state and its `_get` and `_forPrincipal`
  queries, then extend the joined account former and account output validator.
- Preferences are intentionally generic strings. Restrict known scopes, keys,
  and values in endpoint validators or add focused compositions; change the
  concept contract when richer typed values need to be persisted and queried.
- For notification fields, update Notifying delivery and inbox query contracts,
  the account former, and both endpoint output validators. Keep email, push, or
  other channel state in separate concepts when they have distinct lifecycle
  and failure semantics.

After a contract change, regenerate the wire and read-back artifacts, run the
concept and composition evidence, typecheck the application, and rerun
`src/scenario.ts`. Review persisted-data migrations and trusted-adapter bindings
as part of the same change.

## Source map

| Path                                                         | Role                                                                                  |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `src/concepts/`                                              | Profiling, Preferring, and Notifying specs, implementations, registries, and evidence |
| `src/concept-set.ts`                                         | Local named registrations and default implementations                                 |
| `src/composition/account-center.ts`                          | Joined account former, validated endpoints, and refusal branches                      |
| `src/composition/account-center.test.ts`                     | Composition declaration and validator evidence                                        |
| `src/assembly.ts`                                            | Implementation overrides and execution limits                                         |
| `src/edge.ts`                                                | Standard local gateway                                                                |
| `src/scenario.ts`                                            | End-to-end asserting typed-client scenario                                            |
| `tests/application.test.ts`                                  | Scenario, overrides, validation, and generated read-back coverage                     |
| `generated.config.ts`                                        | Artifact command configuration                                                        |
| [`generated/account-center.md`](generated/account-center.md) | Pinned assembled read-back                                                            |
| [`generated/wire.ts`](generated/wire.ts)                     | Pinned TypeScript wire contract                                                       |

## Individual checks

Use these commands to isolate a failed aggregate check:

```sh
bun run test
bun run typecheck
bun run artifacts:check
```

Run `bun run artifacts:pin` only after an intentional composition or contract
change. Review both generated diffs.
