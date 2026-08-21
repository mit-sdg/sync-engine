# Behavioral evidence guidance

Establish application behavior through the requested frontend when one is in scope;
otherwise use the application's own boundary, an endpoint through its gateway, a typed
client, or the host. Calling a concept class directly is concept evidence, not evidence
that the assembled application delivers a brief outcome. When the selected transport is
the sync-engine HTTP companion, construct its generated-wire gateway and package handler
or start the real listener. A hand-written router, direct concept call, or substitute
function with the same handler name is not HTTP boundary evidence.

Before accepting existing evidence, inventory the exact brief-selected method, public
path, input fields, output fields, credentials, and error envelope against the assembled
public interface. Any drift is a blocker; do not call an alternate route and bless it in a
new test.

Existing evidence is sufficient when it already proves every relevant outcome through
the selected boundary. Otherwise add the smallest scenarios capable of disproving
required visible successes and applicable refusals, authorization, repetition,
lifecycle, integration, host behavior, partial failure, and recovery. For promised
compensation, test both the inducing failure and a follow-up operation that distinguishes
clean recovery from leaked state. For promised idempotency, repeat the same stable
operation identity and test that the effect occurs once. Do not duplicate a large
implementation test suite or assert behavior absent from the brief and approved contracts.

Trace each relevant brief outcome to a concrete test or scenario and its observed result.
A warning is relevant only when it identifies a plausible gap in a required outcome;
conservative analysis alone does not require warning elimination. Judge behavioral
commitments rather than a particular stage layout or whether coordination
is folded into an endpoint or placed in a separately selected reaction. Exercise declared
error envelopes and the caller-visible behavior of indistinguishable
refusals. When an obligation permits a false interval, test the recovery path and stable
retry identity rather than assuming immediate cross-owner consistency. Avoid narrow
wall-clock sleeps: use already-past and comfortably-future timestamps, or a controlled
clock when transition timing itself is the behavior under test.

Never claim multi-action atomicity without one semantic owner and one transaction. Source
agreement, generated artifacts, types, and successful assembly are structural evidence;
they do not prove persistence, transactionality, authorization, restart behavior, or
caller-visible semantics.
