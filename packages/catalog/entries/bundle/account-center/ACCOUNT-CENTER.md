# Account center starter

This bundle installs a runnable account-center application built from three
independent concepts:

- Profiling owns one display profile for each opaque external principal.
- Preferring owns ordered `scope`/`key`/`value` preferences for a profile.
- Notifying owns an ordered in-app inbox with read and dismissed state.

The account-center recipe exposes profile, preference, trusted inbox-delivery,
read, dismiss, and joined-account endpoints. The bundle also installs the
concept set, assembly, local gateway, generated-artifact configuration, and an
asserting scenario.

This is a useful application starter, not a production authentication or
authorization system. All installed source is application-owned and should be
adapted to the deployment.

## Bind identity in a trusted adapter

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

## Persist state

The installed implementations keep state in memory, so process restart loses
profiles, preferences, and notifications. `assembleAccountCenter` and
`buildAccountCenter` accept `AccountCenterOverrides`, allowing the application
to inject structurally compatible implementations for `Profiling`,
`Preferring`, and `Notifying`.

For durable deployment, replace or adapt the copied implementations around a
database or repository and pass those instances to the assembly. Preserve the
registered action/query shapes and registered refusal error classes. Storage
operations should enforce principal uniqueness atomically, preserve first-set
preference order, and retain notification order and read/dismiss state under
concurrent requests. Use migrations, transactions, indexes, and deployment-owned
ID generation appropriate to the datastore; do not treat an occasional dump of
the in-memory maps as durable storage.

The catalog's repository Profiling variant is a useful storage seam to adapt.
Preferring and Notifying need equivalent application-owned durable
implementations. Exercise the scenario and concept conformance evidence against
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

Installed endpoints validate exact object keys and bounded strings at runtime.
Principals, profile IDs, scopes, keys, topics, and notification IDs are limited
to 128 characters; subjects to 256; preference values and messages to 4,096.
Joined-account output is also validated, including every preference and inbox
row.

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

Change the copied concept specification, implementation, and registry together,
then update recipes and runtime validators that expose the changed data.

- For profile fields, update Profiling state and its `_get` and `_forPrincipal`
  queries, then extend the joined account former and account output validator.
- Preferences are intentionally generic strings. Restrict known scopes, keys,
  and values in endpoint validators or add focused recipes; change the concept
  contract when richer typed values need to be persisted and queried.
- For notification fields, update Notifying delivery and inbox query contracts,
  the account former, and both endpoint output validators. Keep email, push, or
  other channel state in separate concepts when they have distinct lifecycle
  and failure semantics.

After a contract change, regenerate the wire and read-back artifacts, run the
concept and recipe evidence, typecheck the application, and rerun
`src/scenario.ts`. Review persisted-data migrations and trusted-adapter bindings
as part of the same change.
