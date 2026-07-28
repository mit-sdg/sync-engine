# Application boundary

An endpoint specializes the reaction frame at the application boundary. It
gives an outside caller a stable path into the operations room, with an input
contract, correlation, and a response from the authored design.

This page assembles the room, declares one endpoint, places the gateway in front
of it, and calls the result through a generated TypeScript contract. It assumes
the concepts, reactions, views, and formers from the preceding guides.

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

`assemble` installs one vocabulary and one composition. The vocabulary names
the concepts and their refusals. The composition collects the room boundary
declarations, the selected reaction modules, one policy module, and the shared
contribution boundary declarations that make this particular application.

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

Ordinary assembly can leave `instances` empty. The other options select
composition: the same concept classes can run with or without the two reaction
packs, or with a different contribution policy.

Each call creates a new application. Changing an option and running again does
not replace reactions inside an application that is already running.

Assembly draws a hard portability line at this boundary. Endpoint reactions and
every view or former they reference transitively must be canonical
JSON-round-trippable definitions that can be registered against the same named
vocabulary. Closures, `custom` operations, object-identity patterns, raw
transforms, and whole unlowered reactions are local and cannot occur on that
reachable surface. A `localBehavior` review contract can admit exact
non-boundary local definitions, but it never overrides an endpoint rejection.
Assembly validates this before returning the application's route set.

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
use. Every matching branch runs, and labels establish provenance rather than
priority or exclusivity. If several branches answer, the boundary accepts one
response and refuses another with `NOT_PENDING`. [The example
book](../book.md#12--an-endpoint-uses-the-same-sibling-shape) shows this boundary
specialization, and [Execution semantics](../semantics.md#sibling-paths-and-endpoint-settlement)
defines its lowering and settlement.

Cover every admitted case on a public endpoint with an answer or an explicit
fallback branch. If no branch responds and the flow is fault-free, invocation
waits 30 seconds by default and then returns `TIMED_OUT`. If the interpreter
fails while matching or advancing a path and no sibling answers, the flow
settles promptly with opaque `INTERNAL_ERROR`; an answer already delivered
still wins. A direct `Invoker` caller can set `InvokeOptions.timeoutMs` or supply
an abort `signal`; neither operation cancels work already forwarded into the
application.

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

`createGateway` is the fixed standard gateway, not a general gateway assembly.
Application code supplies the application rather than replacing its vocabulary
or routing design.

## Generate the wire contract

The tooling reads the assembled design and derives TypeScript contracts from
portable reaction data. Generation is all-or-nothing: local endpoint behavior
or a transitively local endpoint view/former fails assembly with the endpoint
and local owner rather than omitting its contract. Reviewed non-boundary local
definitions remain visible with reasons and revision in diagnostics and the
assembled read-back; whole unlowered reactions are included rather than
dropped. One application descriptor names the assembly and the application;
the artifact paths and type names follow from the title and the config's own
location, and each may be overridden:

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

An application exposing the production public-error policy supplies either its
credential-free `httpProfile` or its cookie-bound `httpFloor` in this
descriptor, so the generated module carries both the logical application
contract and its projected HTTP form. A floor projection also removes the
credential input and consumed issue outputs. [Execution
semantics](../semantics.md#boundary-gateway-and-client) owns the fixed cookie
and HTTP behavior; the [public API](../public-surface.md#generated-descriptor)
lists every descriptor field and default.

The generated route records its admitted input, success body, and every
endpoint or application error derived from the assembly. Here the
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

Use the vocabulary anchor and `strictLeaves` for a published client contract.
[Generated wire](../semantics.md#generated-wire) owns the complete derivation
and JSON-projection rules.

Keep the generated module in source control and publish it with the application
contract. Its relative vocabulary path must resolve from the published type
graph. A separate client package therefore includes the vocabulary
declarations beside the wire. The import is type-only and does not add concept
instances or engine code to the browser bundle. Before publishing, regenerate
the files, review the wire diff, and typecheck a consumer against the packed
package.

The generated contract is a compile-time guarantee, not a runtime schema.
Standard admission checks that input is an object and required keys are present.
For untyped or hostile callers, attach schema-library-neutral validators to the
endpoint:

```typescript
endpoint("/rooms/create", createRoom, {
  validators: {
    input: (value) =>
      isCreateRoomInput(value)
        ? { ok: true }
        : { ok: false, detail: "host and name must be strings" },
    output: (value) => (isCreateRoomOutput(value) ? { ok: true } : { ok: false }),
  },
});
```

The input validator runs after shallow defaults and before the application ask.
The output validator protects successful results; a violation is retained as
integrity evidence and leaves the invoker as opaque `INTERNAL_ERROR`.
[Execution semantics](../semantics.md#boundary-gateway-and-client) defines the
complete admission boundary.

## Call the typed client

Frontend code imports the generated wire and the canonical `client` subpath.
It does not import concepts, reactions, the gateway, or the application.

_Source: [`examples/operations-room/src/client.ts`](../../examples/operations-room/src/client.ts)_

```ts
export type OperationsRoomClient = Client<OperationsRoomWire>;

export function createOperationsRoomClient(options: HttpClientOptions = {}): OperationsRoomClient {
  return createHttpClient<OperationsRoomWire>(options);
}
```

The operations-room edge uses the low-level raw HTTP adapter with the same
`/api` prefix as the browser client:

_Source: [`examples/operations-room/src/edge.ts`](../../examples/operations-room/src/edge.ts)_

```ts
export function buildOperationsRoomHttp(instances: OperationsRoomOverrides = {}) {
  const { application, gateway } = buildOperationsRoom(instances);
  const handler = createHttpHandler({ gateway, basePath: "/api" });
  return { application, gateway, handler };
}
```

That gateway-only form deliberately preserves logical error envelopes and is
not the recommended direct public deployment boundary. A public JSON host uses
the production profile and supplies the assembly so registered category
metadata is available:

_Source: [`examples/production-http/src/edge.ts`](../../examples/production-http/src/edge.ts)_

```ts
export const productionHttpProfile = defineProductionHttpProfile({
  origin: "https://production-http.test",
  basePath: "/api",
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

The client creates a browser-facing instance with that prefix and narrows the result before
reading the dashboard:

_Source: [`examples/operations-room/src/client.ts`](../../examples/operations-room/src/client.ts)_

```ts
export const operations = createOperationsRoomClient({ baseUrl: "/api" });

export async function loadRoomDashboard(client: OperationsRoomClient, room: string) {
  const result = await client.rooms.get({ room });
  if ("error" in result) return { message: `Could not load the room: ${result.error}` };
  return result.dashboard;
}
```

Each client call resolves to the endpoint's success JSON or an error envelope.
Checking for `error` narrows the TypeScript union before success fields are
read. The [public API](../public-surface.md#client) names the client options;
[execution semantics](../semantics.md#boundary-gateway-and-client) owns the
result, transport, and framework-error guarantees.

## Organize host-owned deployment code

The shipped examples keep the assembly in one file. Their application-owned
source and generated outputs follow this layout:

| Location              | Contents                                                                       |
| --------------------- | ------------------------------------------------------------------------------ |
| `src/concepts/`       | Generic behavior: specification, class, refusals, registry, and principle test |
| `src/concept-set.ts`  | One explicit set deriving vocabulary, references, and implementation floors    |
| `src/composition/`    | Reactions, views, formers, boundary declarations, and selectable packs         |
| `src/assembly.ts`     | Vocabulary, composition, and concept implementation choices                    |
| `src/edge.ts`         | Standard gateway and transport handler                                         |
| `src/client.ts`       | Generated-contract client used outside the backend                             |
| `src/scenario.ts`     | A runnable path through the assembled application                              |
| `generated/`          | Pinned assembled read-back and wire contract                                   |
| `generated.config.ts` | Assembly and output metadata for checking or pinning generated artifacts       |

When deployment owns several resource sets, make those choices visible in one
assembly folder:

| Location                        | Contents                                                             |
| ------------------------------- | -------------------------------------------------------------------- |
| `src/assembly/application.ts`   | The stable join of the concept set and explicit composition manifest |
| `src/assembly/concept-floor.ts` | Complete named implementation sets, shared resources, and `close()`  |
| `src/assembly/http-profile.ts`  | Public origin, base path, and public-error transport policy          |
| `src/assembly/http-floor.ts`    | Optional same-origin cookie binding                                  |
| `src/assembly/process.ts`       | Process startup and shutdown ownership                               |
| `src/assembly/README.md`        | Configuration router and the application's floor boundary            |

An implementation is one concrete concept object. An override replaces one
implementation after selecting a complete floor and is suitable for test
substitution, not as another production floor. A concept floor is a named,
complete implementation map with its shared resources and asynchronous
`close()`. A production HTTP profile carries public error projection, bounded
JSON parsing, correlation, and status decoration. An HTTP floor adds one cookie
credential and same-origin check. Domain authentication, authorization, and
concept meaning remain in the application. The process creates and owns the
selected resources, starts the handler, and closes the concept floor during
shutdown.

In the folder form, ordinary features change the concept set or composition
manifest. Floor and process files change only with the runtime substrate or
deployment boundary. These are folder-depth choices, not different authoring
conventions: source stays under `src/`, while generated artifacts remain
visibly derived beside it.

Assembly and gateway expose `beginDrain()` and `whenIdle()`, but `close()` is
not called by assembly and timeout or abort can leave accepted work running
after the caller stops waiting. The host must stop the listener, begin drain,
apply its hard deadline, and close resources in order. The folder layout
identifies ownership; it does not make graceful shutdown automatic.
[Operational limits](../operations.md) states the host responsibilities and
unsupported deployment guarantees.

The complete local scenario crosses the same gateway with a generated client
contract in [`scenario.ts`](../../examples/operations-room/src/scenario.ts).
For exact admission, settlement, error, and JSON behavior, use [Execution
semantics](../semantics.md#boundary-gateway-and-client). For every exported
constructor and option, use the [Public API](../public-surface.md).
