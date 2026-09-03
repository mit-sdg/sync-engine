# Catalog concepts

These concepts are already generic: each names a mechanism rather than a product, and
takes what it acts on as an opaque parameter. Cover a need by instantiating one where it
fits, adapt one where it nearly fits, and invent only where none does. They are
alternatives, never mandatory names or contracts, and these are all there are. Most
briefs need a mechanism none of them covers, so "no entry fits, because ..." is an
expected answer rather than a fault. Mark an entry `catalog-unchanged` only when the
product needs every listed action and query; otherwise mark it `catalog-adapted` and keep
only the needed surface during contract authoring.

Obtain full contracts with `bunx --no-install sync-engine-catalog list` and
`bunx --no-install sync-engine-catalog show concept/<name>`. Supply command output inline;
never read package trees or `dist` entries.

- **Alerting** — Keep an addressed matter visible until its recipient acknowledges it, so pending attention survives retries and does not depend on memory. Surface: `raise`, `acknowledge`, `_openFor`, `_get`.
- **Approving** — Separate a request from an assigned reviewer's durable decision, so pending work is not mistaken for accepted work and a requester cannot approve the request alone. Surface: `request`, `approve`, `reject`, `withdraw`, `_get`, `_pendingFor`, `_history`.
- **Auditing** — Keep a permanent numbered record of who did what to which target, so past activity can be attributed and read back afterwards instead of being reconstructed from state that shows only its current values. Surface: `record`, `_get`, `_since`, `_byActor`, `_forTarget`, `_extent`.
- **Authenticating** — Establish a username from a password, so a username claim alone cannot act as proof of identity and a compromised password can be replaced or removed. Surface: `register`, `authenticate`, `changePassword`, `unregister`, `_registered`.
- **Commenting** — Attach authored comments to an external target and let only the author retract each comment, so discussion can accumulate without allowing one author to erase another's contribution. Surface: `add`, `retract`, `_for`, `_get`.
- **Expiring** — Record a deadline for a subject and answer whether it has lapsed at a given instant, so lapsing happens by the passing of time alone and needs no action from anyone. Surface: `schedule`, `reschedule`, `cancel`, `_deadline`, `_lapsed`.
- **Inviting** — Record a directed offer that only its intended recipient may accept or decline, so participation requires consent from both the inviter and invitee. Surface: `issue`, `accept`, `decline`, `revoke`, `_get`, `_pendingFor`.
- **Labeling** — Classify an item under several stable names in one scope, so the item can be found through overlapping categories instead of being placed in one exclusive container. Surface: `create`, `rename`, `apply`, `remove`, `_get`, `_for`, `_items`.
- **Posting** — Publish immutable authored messages in chronological order, so a contribution remains visible and attributed without depending on an external content store. Surface: `publish`, `_all`, `_get`, `_byAuthor`.
- **Registering** — Accept each identified occurrence once against a subject, so a report that arrives twice is recognised as the same one and only genuinely new occurrences reach whatever acts on them. Surface: `register`, `deregister`, `_registration`, `_registrations`.
- **Reserving** — Give one claimant an exclusive claim on a reservable unit, so the same unit is not promised to competing claimants. Surface: `reserve`, `cancel`, `fulfill`, `_blocking`, `_get`, `_activeFor`.
- **Selecting** — Keep one current item for a shared scope, so everyone working in that scope can begin from the same choice. Surface: `choose`, `clear`, `_current`, `_get`.
- **Sessioning** — Issue an opaque session for an external subject with a caller-chosen lifetime, so temporary access ends without changing that subject's identity. Surface: `start`, `current`, `end`, `_active`.
- **Tallying** — Keep a running total of how often something has happened to a subject, so the count can be read back without keeping a record of each separate occurrence. Surface: `increment`, `clear`, `_total`.
- **Trashing** — Record a reversible removal before making that removal irreversible, so an accidental removal can be restored without leaving every removal permanently reversible. Surface: `trash`, `restore`, `purge`, `_state`, `_trashed`.
- **Upvoting** — Record one current preference from each voter about an item, so an aggregate score reflects distinct voters rather than repeated clicks. Surface: `upvote`, `downvote`, `unvote`, `_vote`, `_score`.
