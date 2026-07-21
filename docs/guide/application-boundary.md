# Application boundary

An endpoint specializes the reaction frame at the application boundary. It
gives an outside caller a stable path into the operations room, with an input
contract, correlation, and a response from the authored design.

This page assembles the room, declares one endpoint, places the gateway in front
of it, and calls the result through a generated TypeScript contract.

## Application files and floors

Small applications can keep the assembly in one file:

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

Larger applications can make the runtime choices visible in one assembly
folder:

| Location                        | Contents                                                             |
| ------------------------------- | -------------------------------------------------------------------- |
| `src/assembly/application.ts`   | The stable join of the concept set and explicit composition manifest |
| `src/assembly/concept-floor.ts` | Complete named implementation sets, shared resources, and `close()`  |
| `src/assembly/http-floor.ts`    | Credential binding and public origin for the fixed HTTP boundary     |
| `src/assembly/process.ts`       | Process startup and shutdown ownership                               |
| `src/assembly/README.md`        | Configuration router and the application's floor boundary            |

An **implementation** is one concrete concept object. An **override** replaces
one implementation after an application has selected a complete floor; it is
useful for a test substitution but is not another production floor. A
**concept floor** is a named, complete implementation map together with its
shared resources and shutdown operation. An **HTTP floor** carries the logical
application interface over HTTP: credentials, origin checks, parsing,
serialization, cookies, and status decoration belong there, while domain
authorization and concept meaning do not. The **process** creates and owns the
selected resources, starts the boundary handler, and closes the floor during
shutdown.

In the folder form, `application.ts` should not change for an ordinary feature.
A new concept changes the explicit concept set; a new composition file changes
the explicit composition manifest. Floor and process files change only when
the runtime substrate or deployment boundary changes.

The repository's `examples/concepts/` directory holds generic concepts used by
either example; a standalone application normally owns them under
`src/concepts/`. A small application may keep its composition in one file; the
reading circle uses a vocabulary and one composition module. The operations
room separates policy, reaction packs, reads, and endpoints within
`src/composition/`. A larger application may divide the same directory by
product area. Those are folder-depth choices, not different conventions:
authored application source lives under `src/`, while generated artifacts stay
visibly derived beside it.

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
lives in one shared example helper:

_Source: [`examples/support/identities.ts`](../../examples/support/identities.ts)_

```ts
export function identities(...values: string[]): () => string {
  const remaining = [...values];
  return () => remaining.shift() ?? "unexpected";
}
```

Ordinary assembly can leave `instances` empty. The other options select
composition: the same concept classes can run with or without the two reaction
packs, or with a different contribution policy.

Each call creates a new application. Changing an option and running again does
not replace reactions inside an application that is already running.

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

The tooling reads the assembled design and derives a TypeScript contract for
every endpoint. One application descriptor gives the engine the assembly and
the names and locations of both generated artifacts:

_Source: [`examples/operations-room/generated.config.ts`](../../examples/operations-room/generated.config.ts)_

```ts
import { assembleOperationsRoom } from "./src/assembly.ts";

export default {
  assemble: assembleOperationsRoom,
  directory: new URL("./generated/", import.meta.url),
  specification: "operations-room.md",
  title: "Operations room",
  wire: "wire.ts",
  wireBanner: "// Generated from the operations-room assembly. Do not edit.",
  wireName: "OperationsRoomWire",
  wireVocabulary: { from: "../src/concept-set.ts", export: "vocabulary" },
};
```

From a project where `@mit-sdg/sync-engine` is installed, this command pins
both shipped example files:

```sh
bunx sync-engine artifacts pin --config node_modules/@mit-sdg/sync-engine/examples/operations-room/generated.config.ts
```

Write the concepts, vocabulary, composition, and assembly first. The command
inspects the assembly without importing a gateway or client. The descriptor's
vocabulary path is relative to the generated file. The generated module imports
that value as a type, so it adds no server code to a frontend bundle. Use
`bunx sync-engine artifacts check` in a repository gate, `spec` or `wire` to
inspect one artifact on standard output, and `pin-spec` or `pin-wire` when only
one golden should be rewritten.

An application with a cookie credential also supplies its `httpFloor` in this
descriptor, so the generated module carries both the logical application
contract and its HTTP form. [Execution
semantics](../semantics.md#boundary-gateway-and-client) owns the fixed cookie
and HTTP behavior; the [public API](../public-surface.md#boundary) names the
descriptor fields.

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

The HTTP adapter uses the same `/api` prefix as the browser client and places
the gateway behind a Fetch handler:

_Source: [`examples/operations-room/src/edge.ts`](../../examples/operations-room/src/edge.ts)_

```ts
export function buildOperationsRoomHttp(instances: OperationsRoomOverrides = {}) {
  const { application, gateway } = buildOperationsRoom(instances);
  const handler = createHttpHandler({ gateway, basePath: "/api" });
  return { application, gateway, handler };
}
```

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

## Contract boundaries

The generated TypeScript contract checks typed callers. Runtime admission,
concept refusals, framework faults, serialization, and the limits of that type
contract belong to [execution
semantics](../semantics.md#boundary-gateway-and-client). Review that boundary
before publishing a client contract.

The complete local scenario crosses the same gateway with a generated client
contract in [`scenario.ts`](../../examples/operations-room/src/scenario.ts).

One authored boundary connects outside JSON to concept actions and back. The
generated wire contract carries that boundary to frontend code, while the
concepts and composition remain on the server side.

Continue to [Views and formers](views-and-formers.md) to change who may
contribute and to build the dashboard shape returned by `/rooms/get`. For the
gateway's exact admission and failure behavior, see
[Execution semantics](../semantics.md#boundary-gateway-and-client).
