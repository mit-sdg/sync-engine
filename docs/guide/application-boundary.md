# Application boundary

An endpoint gives an outside caller a named route into composed behavior. This
case-study guide assembles Operations Room, follows one endpoint through the
standard gateway, generates its TypeScript contract, and calls it through a
typed client. It assumes the concepts, reactions, views, and formers from the
preceding guides.

## Run the shipped path

The Operations Room scenario already crosses an assembled application, the
standard gateway, and a local client typed by its generated contract. Run this
from the source-checkout root after installing its dependencies:

```sh
bun run example:operations
```

From an independently copied `examples/operations-room/` directory, use
`bun install` followed by `bun run start` instead.

The scenario source is
[`examples/operations-room/src/scenario.ts`](../../examples/operations-room/src/scenario.ts).
The sections below follow that runnable path from `assembly.ts` through
`edge.ts`, `generated/wire.ts`, and `client.ts` before discussing larger
deployment layouts.

## Assemble one application

`assemble` installs one vocabulary, one concrete instance of each concept, and
one composition. Operations Room's composition collects room endpoints,
selected reaction packs, one contribution policy, and the policy-parameterized
contribution endpoints.

### Select example options

An override supplies a ready-made concept object for one name while keeping the
rest of the selected implementation set. The helper derives that partial shape
from the vocabulary, so the assembly does not repeat concept names or classes.

_Source: [`examples/operations-room/src/assembly.ts`](../../examples/operations-room/src/assembly.ts)_

```ts
export type OperationsRoomOverrides = ImplementationOverrides<typeof vocabulary>;
```

_Source: [`examples/operations-room/src/assembly.ts`](../../examples/operations-room/src/assembly.ts)_

```ts
export function assembleOperationsRoom({
  alerts = true,
  contributions = "responders",
  discussion = true,
  instances = {},
}: OperationsRoomOptions = {}) {
  const policy = contributions === "responders" ? respondersMayContribute : hostMayContribute;

  const selected = { ...operationsRoomConcepts.implementations(), ...instances };

  return assemble({
    vocabulary,
    instances: selected,
    composition: {
      room,
      discussion: discussion ? { SelectedMitigationOpensDiscussion } : {},
      alerts: alerts ? { SelectedMitigationAlertsResponders } : {},
      policy,
      contributions: contributionEndpoints({
        denied: policy.deniedContribution,
        mayContribute: policy.responderMayContribute,
        mayNotContribute: policy.responderMayNotContribute,
      }),
    },
  });
}
```

The scenarios select the concept set's complete deterministic floor so their
generated identities stay fixed. Tests may still overlay one ready-made
implementation after the ordinary floor is selected. Identity generation
lives in an example-local helper:

_Source: [`examples/operations-room/src/identities.ts`](../../examples/operations-room/src/identities.ts)_

```ts
export function identities(...values: string[]): () => string {
  const remaining = [...values];
  return () => {
    const next = remaining.shift();
    if (next === undefined) {
      throw new Error("identities exhausted: supply enough values for every expected id.");
    }
    return next;
  };
}
```

Ordinary assembly can leave `instances` empty. Operations Room exposes
`instances` for test or host substitution. Its other options select
composition: the same concept classes can run with or without the two reaction
packs, or with a different contribution policy.

Each call creates a new application. Changing an option and running again does
not replace reactions inside an application that is already running.

### Construct composition with a TypeScript factory

A composition factory is an ordinary TypeScript function called while the host
constructs `AssemblyOptions`. It returns a plain record of tagged reactions,
views, formers, or endpoints. Operations Room supplies its selected policy views
to one such factory:

_Source: [`examples/operations-room/src/composition/contributions.ts`](../../examples/operations-room/src/composition/contributions.ts)_

```ts
export function contributionEndpoints({
  denied,
  mayContribute,
  mayNotContribute,
}: {
  denied: string;
  mayContribute: RelationView;
  mayNotContribute: RelationView;
}) {
  const AddContribution = endpoint(
    "/rooms/contribute",
    ({ room, responder, text, selection, discussion, response }) =>
      receive({ room, responder, text })
        .where(
          mayContribute({ responder, room }),
          Selecting._current({ scope: room }).is({ selection }),
          Discussing._openFor({ subject: selection }).is({ discussion }),
        )
        .then(Discussing.respond({ discussion, author: responder, text }).responds({ response }))
        .then(respond({ response })),
  );

  const RejectContribution = endpoint("/rooms/contribute", ({ room, responder, text }) =>
    receive({ room, responder, text })
      .where(mayNotContribute({ responder, room }))
      .then(respond({ error: denied })),
  );

  return { AddContribution, RejectContribution };
}
```

The application calls this function; `assemble(...)` never invokes functions it
encounters while walking `composition`. Assembly recursively visits plain
records and module namespaces, registers tagged declaration leaves, ignores
untagged helpers and constants, and gives nested reactions dotted names such as
`contributions.AddContribution`.

The factory runs during construction. Every
declaration it returns must still lower to portable IR; embedding a closure or
other local escape inside a returned declaration does not make that behavior
portable. Generated artifacts describe only the declarations returned by the
factory. Use fixed records for selectable
reaction packs, modules with the same view contract for replaceable
policy, and factories when declarations themselves depend on supplied policy.

Assembly validates that all installed reactions, views, formers, and endpoints
are portable before returning the application's route set. [Portable and local
behavior](../semantics.md#portable-and-local-behavior) defines that boundary and
the `advanced` escape hatches.

## Receive, ask, respond

An **endpoint** specializes the reaction frame at the application boundary. It
adds an outside trigger, path, input contract, correlation, and response. The
mitigation endpoint uses three boundary words in order.

Composition files import the endpoint frame from `boundary` and the reads and
consequences used inside that frame from `language`. The operations-room file
shows the complete split:

_Source: [`examples/operations-room/src/composition/room.ts`](../../examples/operations-room/src/composition/room.ts)_

```ts
import { endpoint, receive, respond } from "@mit-sdg/sync-engine/boundary";
import { each, form, former, whether, where } from "@mit-sdg/sync-engine/language";
import { concepts } from "../concept-set.ts";

const { Alerting, Discussing, Gathering, Selecting } = concepts;
```

_Source: [`examples/operations-room/src/composition/room.ts`](../../examples/operations-room/src/composition/room.ts)_

```ts
export const ChooseMitigation = endpoint(
  "/rooms/choose-mitigation",
  ({ room, mitigation, selection }) =>
    receive({ room, mitigation })
      .then(Selecting.choose({ scope: room, item: mitigation }).responds({ selection }))
      .then(respond({ mitigation })),
);
```

`receive` states the JSON keys the caller supplies. The consequence asks
`Selecting.choose` and binds the selection on its returned occurrence.
`respond` supplies the success JSON after that request returns. When a requested
action has a refusal, as `Gathering.join` does, the standard refusal path
answers with the code registered in the vocabulary; the endpoint does not
repeat that handling.

The application boundary is independent of HTTP. A local client and an HTTP
adapter can call the same endpoint declarations.

An endpoint can also answer differently by case. `receive(...)` supplies the
outside-request trigger to the same labeled sibling tree ordinary reactions
use. Every matching branch runs, and labels establish provenance. Labels carry
no priority or exclusivity. If several branches answer, the boundary accepts one
response and refuses another with `NOT_PENDING`. [The read construction
cookbook](../book.md#12--an-endpoint-uses-the-same-sibling-shape) shows this
boundary specialization, and [Execution
semantics](../semantics.md#sibling-paths-and-endpoint-settlement) defines its
lowering and settlement.

Cover every admitted case on a public endpoint with an answer or explicit
complementary case branches. An unconditional sibling overlaps every
conditional branch that can answer. A
fault-free request that no branch answers remains pending until its deadline and
returns `TIMED_OUT`. `applicationDiagnostics(...)` traces causal `by`
provenance to attribute an eventual response to its request path. Only a
response that uses the traced request identifier on a direct
request-to-response answer path contributes to overlap or coverage proof. An
intermediate action posture makes the path ineligible for either proof.
On direct paths, the analysis recognizes canonical `receive(...)` shapes,
disjoint literal request alternatives, non-dropping `whether` lines, and fresh
computations. It reports bounded potential overlaps and cases where no
non-dropping total answer path is recognized. Complementary state reads remain
unproved because siblings observe separate state snapshots; opaque policy
remains the author's responsibility.
Timeout and abort stop the caller's wait without cancelling accepted work. [Endpoint
settlement](../semantics.md#sibling-paths-and-endpoint-settlement) and
[cancellation](../semantics.md#cancellation) define the complete behavior.

## Put the standard gateway in front

The public gateway factory has one ordinary shape. Give it the assembled
application; it supplies the standard routing, input admission, forwarding,
and response path.

_Source: [`examples/operations-room/src/edge.ts`](../../examples/operations-room/src/edge.ts)_

```ts
export function buildOperationsRoom(instances: OperationsRoomOverrides = {}) {
  const application = assembleOperationsRoom({ instances });
  const gateway = createGateway<OperationsRoomWire>({ application });
  return { application, gateway };
}
```

`createGateway` applies the standard gateway vocabulary and routing behavior to
the supplied application.

## Generate the wire contract

The tooling reads the assembled design and derives TypeScript contracts from
portable reaction data. Generation is all-or-nothing: any local definition
fails assembly with its owner. One
application descriptor names the assembly and the application;
the artifact paths and type names follow from the title and the config's own
location, and each may be overridden.

### Configure generation

The minimal descriptor supplies the assembly function and application title:

_Source: [`examples/operations-room/generated.config.ts`](../../examples/operations-room/generated.config.ts)_

```ts
import { assembleOperationsRoom } from "./src/assembly.ts";

export default {
  assemble: assembleOperationsRoom,
  title: "Operations room",
};
```

Generation writes beside the config by default. Work from an
application-owned copy, never from the example under `node_modules`. After
copying `examples/operations-room/` into your project and installing its
dependencies, run this in the copied application's directory to pin both
files:

```sh
bun run artifacts:pin
```

Write the concepts, vocabulary, composition, and assembly first. The command
inspects the assembly without importing a gateway or client. The descriptor's
vocabulary path is relative to the generated file. The generated module imports
that value as a type, so it adds no server code to a frontend bundle. Use
`bunx sync-engine artifacts check` in a repository gate, `spec` or `wire` to
inspect one artifact on standard output, and `pin-spec` or `pin-wire` when only
one artifact should be rewritten.

An application exposing a transport-specific public contract supplies an ordered
`projections` list. The HTTP companion uses
`httpWire({ policy, name })`, reusing the exact policy object passed to the
handler, so the generated module carries both the logical application contract
and its projected HTTP form. A floor projection also removes the credential
input and consumed issue outputs. [Execution
semantics](../semantics.md#boundary-gateway-and-client) defines the fixed cookie
and HTTP behavior; the [public API](../public-surface.md#generated-descriptor)
lists every descriptor field and default.

### Read the generated contract

The generated route records its admitted input, success body, application-derived
error union, and input-admission error. Here the
`host` and `name` input leaves refer to `Gathering.create`'s parameter type, and
the returned `room` refers to that action's result.

_Source: [`examples/operations-room/generated/wire.ts`](../../examples/operations-room/generated/wire.ts)_

```ts
  "/rooms/create": {
    input: {
      "host": Jsonify<AtPath<Parameters<(typeof ApplicationVocabulary.concepts)["Gathering"]["create"]>[0], ["host"]>>;
      "name": Jsonify<AtPath<Parameters<(typeof ApplicationVocabulary.concepts)["Gathering"]["create"]>[0], ["name"]>>;
    };
    output: {
      "room": Jsonify<AtPath<Awaited<ReturnType<(typeof ApplicationVocabulary.concepts)["Gathering"]["create"]>>, ["gathering"]>>;
    };
    error: { error: AppWideError | "INVALID_INPUT" };
  };
```

The indexed expressions are generated; callers do not write them. In
this example, an editor resolves all three leaves to `string`, straight from
`GatheringConcept.create`. Passing a number for `host`, or treating `room` as a
number, fails the frontend typecheck.

Do not edit this file by hand. Change the endpoint, views, former, vocabulary,
or reaction that owns the contract, then regenerate it. The checked-in diff
shows how the public boundary changed.

The `sync-engine artifacts` command always uses the vocabulary anchor and
strict leaf resolution. Direct callers of `renderWireTypes(...)` must select
`strictLeaves: true` and supply a vocabulary anchor when unresolved `Json`
leaves must be rejected.
[Generated wire](../semantics.md#generated-wire) defines the complete derivation
and JSON-projection rules.

Keep the generated module in source control and publish it with the application
contract. Its relative vocabulary path must resolve from the published type
graph. A separate client package therefore includes the vocabulary
declarations beside the wire. The import is type-only and does not add concept
instances or engine code to the browser bundle. Before publishing, regenerate
the files, review the wire diff, and typecheck a consumer against the packed
package.

## Add runtime validation

The generated contract checks TypeScript callers at compile time. Standard
admission checks that input is an object and required keys are present.
For untyped or hostile callers, attach schema-library-neutral validators to the
endpoint:

```typescript
endpoint("/rooms/join", joinRoom, {
  validators: {
    input: (value) =>
      isJoinRoomInput(value)
        ? { ok: true }
        : { ok: false, detail: "room and responder must be strings" },
    output: (value) => (isJoinRoomOutput(value) ? { ok: true } : { ok: false }),
    domainError: (value) =>
      value === "GATHERING_NOT_FOUND" || value === "ALREADY_JOINED"
        ? { ok: true }
        : { ok: false, detail: "unexpected join refusal" },
  },
});
```

The input validator runs after shallow defaults and before the application ask.
The output validator receives the complete successful result. The `domainError`
validator receives only the value under an authored response's top-level
`error` field, such as `ALREADY_JOINED`; framework errors bypass it. Validators
observe values without transforming them and must return synchronously. A promise-like
return fails validation. An invalid output or domain-error value causes
integrity evidence and leaves the invoker as opaque `INTERNAL_ERROR`.
[Runtime validation](../semantics.md#runtime-validation) defines the complete
admission and output-validation boundary.

## Call the typed client

Code outside the assembly depends only on a client typed by the generated wire.
The client abstraction hides concepts, reactions, gateways, assemblies, and the
selected transport.

_Source: [`examples/operations-room/src/client.ts`](../../examples/operations-room/src/client.ts)_

```ts
export type OperationsRoomClient = Client<OperationsRoomWire>;

export async function loadRoomDashboard(client: OperationsRoomClient, room: string) {
  const result = await client.rooms.get({ room });
  if ("error" in result) return { message: `Could not load the room: ${result.error}` };
  return result.dashboard;
}
```

Each client call resolves to the endpoint's success JSON or an error envelope.
The generated route contributes its application and admission errors;
`Client<Wire>` also includes generic framework errors such as `TIMED_OUT`,
`INTERNAL_ERROR`, and transport failures. Checking for `error` narrows the
TypeScript union before success fields are read. The [client
API](../public-surface.md#client) names the constructors and options; [boundary
result semantics](../semantics.md#boundary-gateway-and-client) defines error
delivery and JSON projection.

## Use production HTTP

Reading Circle and Operations Room stop at the standard gateway. They do not
present the raw logical-envelope HTTP adapter as a public deployment boundary.
A public JSON host installs the first-party HTTP package, chooses a production
policy, and maps domain refusal codes in that policy:

The example aliases the profile constructor because its local profile value
uses the same descriptive name:

_Source: [`examples/production-http/src/edge.ts`](../../examples/production-http/src/edge.ts)_

```ts
import { createGateway } from "@mit-sdg/sync-engine/boundary";
import {
  createHttpHandler,
  httpFloor,
  productionHttpProfile as defineProductionHttpProfile,
} from "@mit-sdg/sync-engine-http/server";
```

_Source: [`examples/production-http/src/edge.ts`](../../examples/production-http/src/edge.ts)_

```ts
export const productionHttpProfile = defineProductionHttpProfile({
  origin: "https://production-http.test",
  basePath: "/api",
  publicErrors,
});
```

The profile handler also receives the assembly:

_Source: [`examples/production-http/src/edge.ts`](../../examples/production-http/src/edge.ts)_

```ts
const profileHandler = createHttpHandler({
  application,
  gateway,
  profile: productionHttpProfile,
  correlation,
});
```

Use `httpFloor(...)` instead only when the same production policy must also bind
one logical credential to a same-origin cookie. The complete cookie path and
generated projection are checked in the [Production HTTP
example](../../examples/production-http/README.md).

An HTTP-floor caller uses the projected contract, whose type omits credential
fields supplied and consumed by the cookie binding:

_Source: [`examples/production-http/src/client.ts`](../../examples/production-http/src/client.ts)_

```ts
export type ProductionHttpClient = Client<ProductionHttpWireHttp, HttpClientError>;

export function createProductionHttpClient(options: HttpClientOptions = {}): ProductionHttpClient {
  return createHttpClient<ProductionHttpWireHttp>(options);
}
```

## Keep deployment ownership explicit

The shipped examples keep the assembly in one file. Their application-owned
source and generated outputs follow this layout:

| Location              | Contents                                                                       |
| --------------------- | ------------------------------------------------------------------------------ |
| `src/concepts/`       | Generic behavior: specification, class, refusals, registry, and principle test |
| `src/concept-set.ts`  | One explicit set deriving vocabulary, references, and implementation floors    |
| `src/composition/`    | Reactions, views, formers, boundary declarations, and selectable packs         |
| `src/assembly.ts`     | Vocabulary, composition, and concept implementation choices                    |
| `src/edge.ts`         | Standard gateway; production examples also own transport policy and handlers   |
| `src/client.ts`       | Transport-neutral helper or projected generated-contract HTTP client           |
| `src/scenario.ts`     | A runnable path through the assembled application                              |
| `generated/`          | Pinned assembled read-back and wire contract                                   |
| `generated.config.ts` | Assembly and output metadata for checking or pinning generated artifacts       |

A larger host may split assembly, concept-floor selection, HTTP policy, and
process lifecycle into separate files. The ownership does not change: assembly
installs an implementation map but does not call a concept floor's `close()`;
the HTTP handler adapts Fetch requests; and the host owns the listener, server,
process signals, and resource closure.

During shutdown, stop the listener, call `beginDrain()`, await it up to a hard
host deadline, then close the concept floor and any custom log-sink resources.
Timeout or abort may leave accepted work running after a caller stops waiting,
so tracking HTTP promises alone does not establish quiescence. [Operational
limits](../operations.md#timeouts-abort-and-shutdown) defines the required
sequence and recovery consequence of forced shutdown.

The complete local scenario crosses the same gateway with a generated client
contract in [`scenario.ts`](../../examples/operations-room/src/scenario.ts).
For exact admission, settlement, error, and JSON behavior, use [Execution
semantics](../semantics.md#boundary-gateway-and-client). For every exported
constructor and option, use the [Public API](../public-surface.md).
