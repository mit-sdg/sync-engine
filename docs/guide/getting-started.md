# Getting started

Start in an empty directory:

```sh
mkdir operations-room
cd operations-room
```

This chapter builds one small whole before the later chapters revisit its
parts. The rest of the page contains every authored file in that first runnable
slice. Add them in order, then generate the assembled read-back and wire
contract and run the scenario at the end. The application imports only the
installed package; it does not import the engine repository or either bundled
example.

## Project files

`package.json` installs the engine and TypeScript and gives each project command
one name:

```json
{
  "name": "operations-room",
  "private": true,
  "type": "module",
  "scripts": {
    "generate": "sync-engine artifacts pin --config generated.config.ts",
    "typecheck": "tsc --noEmit",
    "principle": "bun src/concepts/rooming/rooming.test.ts",
    "start": "bun src/scenario.ts"
  },
  "dependencies": {
    "@mit-sdg/sync-engine": "latest"
  },
  "devDependencies": {
    "typescript": "^5.9.0"
  }
}
```

`tsconfig.json` uses Node's module rules while allowing the `.ts` extensions
shown in local imports:

```json
{
  "compilerOptions": {
    "lib": ["ESNext", "DOM"],
    "target": "ESNext",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "allowImportingTsExtensions": true,
    "noEmit": true,
    "strict": true,
    "skipLibCheck": true
  },
  "include": ["src", "generated.config.ts", "generated", "*.d.ts"]
}
```

`text.d.ts` lets registries import Markdown specifications as text:

```ts
declare module "*.md" {
  const text: string;
  export default text;
}
```

Install the package before writing application imports:

```sh
bun install
```

## The complete Rooming concept

Create `src/concepts/rooming/spec.md`:

````md
# Rooming

## Purpose

Open named operations rooms so responders can gather around one incident.

## Principle

Mara opens Checkout latency and receives a room. Opening another room with the
same name is refused because the first room is already open. She closes the
room; a second close is refused because the room is no longer open.

## State

```state
a set of Rooms with
  a name String
```

## Actions

```actions
open (name: String) : return (room: Room), refuse (message: String)
  where no room has name
  then
    add a new room with name
    return room
  where some room has name
  then
    refuse "A room with this name is already open."

close (room: Room) : return (), refuse (message: String)
  where room in rooms
  then
    delete room
    return
  where room not in rooms
  then
    refuse "This room is not open."
```

`_get` answers zero or one room for an identity.
````

The specification is the readable contract. For this release, ordinary
TypeScript implements that contract. Create `src/concepts/rooming/errors.ts`:

```ts
export class RoomAlreadyOpen extends Error {}
export class RoomNotOpen extends Error {}
```

Create `src/concepts/rooming/rooming.ts`:

```ts
import { RoomAlreadyOpen, RoomNotOpen } from "./errors.ts";

type Room = { room: string; name: string };

/** Open and close one operations room for each distinct name. */
export class RoomingConcept {
  private readonly rooms = new Map<string, Room>();

  constructor(private readonly freshID: () => string = () => crypto.randomUUID()) {}

  open({ name }: { name: string }) {
    if ([...this.rooms.values()].some((room) => room.name === name)) {
      throw new RoomAlreadyOpen("A room with this name is already open.");
    }
    const room = this.freshID();
    this.rooms.set(room, { room, name });
    return { room };
  }

  close({ room }: { room: string }) {
    if (!this.rooms.delete(room)) throw new RoomNotOpen("This room is not open.");
    return {};
  }

  _get({ room }: { room: string }): Room[] {
    const found = this.rooms.get(room);
    return found === undefined ? [] : [found];
  }
}
```

Create `src/concepts/rooming/registry.ts` to give the behavior its application
name, specification, query promise, and refusal code:

```ts
import { registerConcept } from "@mit-sdg/sync-engine/assembly";
import { RoomAlreadyOpen, RoomNotOpen } from "./errors.ts";
import { RoomingConcept } from "./rooming.ts";
import spec from "./spec.md" with { type: "text" };

export const rooming = registerConcept({
  class: RoomingConcept,
  spec,
  queries: { _get: "optional" },
  refusals: {
    ROOM_ALREADY_OPEN: { error: RoomAlreadyOpen, on: ["open"] },
    ROOM_NOT_OPEN: { error: RoomNotOpen, on: ["close"] },
  },
});
```

Create `src/concepts/rooming/rooming.test.ts`. It drives the Principle directly
against the concept, without an assembly:

```ts
import { RoomAlreadyOpen, RoomNotOpen } from "./errors.ts";
import { RoomingConcept } from "./rooming.ts";

const rooming = new RoomingConcept(() => "checkout-latency");
const opened = rooming.open({ name: "Checkout latency" });
const found = rooming._get({ room: opened.room });

if (found[0]?.name !== "Checkout latency") throw new Error("The opened room was not found.");
try {
  rooming.open({ name: "Checkout latency" });
  throw new Error("The duplicate room was accepted.");
} catch (error) {
  if (!(error instanceof RoomAlreadyOpen)) throw error;
}
rooming.close({ room: opened.room });
if (rooming._get({ room: opened.room }).length !== 0) throw new Error("The room stayed open.");
try {
  rooming.close({ room: opened.room });
  throw new Error("The closed room was closed twice.");
} catch (error) {
  if (!(error instanceof RoomNotOpen)) throw error;
}
```

## The connected behavior

Rooming does not decide what mitigation a room starts with. Create
`src/concepts/mitigating/spec.md` for that independent behavior:

````md
# Mitigating

## Purpose

Keep the current mitigation for an operations room so responders share one
next move.

## Principle

Checkout latency starts with investigation as its mitigation. Mara chooses a
rollback instead, and the rollback becomes current for that room.

## State

```state
a set of Selections with
  a room Room
  a mitigation String

a Current set of Selections
```

## Actions

```actions
choose (room: Room, mitigation: String) : return (selection: Selection)
  then
    remove any selection with room from current
    add a new selection with room and mitigation
    add selection to current
    return selection
```

`_current` answers zero or one current mitigation for a room.
````

Create `src/concepts/mitigating/mitigating.ts`:

```ts
type Selection = { selection: string; room: string; mitigation: string };

/** Keep one current mitigation for each operations room. */
export class MitigatingConcept {
  private readonly selections = new Map<string, Selection>();
  private readonly current = new Map<string, string>();

  choose({ room, mitigation }: { room: string; mitigation: string }) {
    const selection = crypto.randomUUID();
    this.selections.set(selection, { selection, room, mitigation });
    this.current.set(room, selection);
    return { selection };
  }

  _current({ room }: { room: string }): Selection[] {
    const selection = this.current.get(room);
    const found = selection === undefined ? undefined : this.selections.get(selection);
    return found === undefined ? [] : [found];
  }
}
```

Create `src/concepts/mitigating/registry.ts`:

```ts
import { registerConcept } from "@mit-sdg/sync-engine/assembly";
import { MitigatingConcept } from "./mitigating.ts";
import spec from "./spec.md" with { type: "text" };

export const mitigating = registerConcept({
  class: MitigatingConcept,
  spec,
  queries: { _current: "optional" },
});
```

## The concept set and composition

Create `src/concept-set.ts`. This is the only whole-application concept roster;
the vocabulary, references, and ordinary implementation set derive from it:

```ts
import { conceptSet } from "@mit-sdg/sync-engine/assembly";
import { mitigating } from "./concepts/mitigating/registry.ts";
import { rooming } from "./concepts/rooming/registry.ts";

export const operationsRoomConcepts = conceptSet({
  Rooming: rooming,
  Mitigating: mitigating,
});

export const { concepts, vocabulary } = operationsRoomConcepts;
```

Create `src/composition.ts`. The reaction connects the two concepts, the former
names the dashboard read, and the boundary declarations carry outside requests
into the same authored design:

```ts
import { endpoint, receive, respond } from "@mit-sdg/sync-engine/boundary";
import { former, reaction, request, when, where } from "@mit-sdg/sync-engine/language";
import { concepts } from "./concept-set.ts";

const { Mitigating, Rooming } = concepts;

export const RoomStartsWithInvestigation = reaction(({ room }) =>
  when(Rooming.open, {}, { room }).then(
    request(Mitigating.choose, { room, mitigation: "investigate" }),
  ),
);

export const roomDashboard = former("the operations room (room)", ({ room, name, mitigation }) =>
  where(Rooming._get({ room }).is({ name }), Mitigating._current({ room }).is({ mitigation })).form(
    { room, name, mitigation },
  ),
);

export const OpenRoom = endpoint("/rooms/open", ({ name, room }) =>
  receive({ name }).then(request(Rooming.open, { name }, { room }), respond({ room })),
);

export const GetRoom = endpoint("/rooms/get", ({ room }) =>
  receive({ room }).then(respond({ dashboard: roomDashboard(room) })),
);
```

Create `src/assembly.ts`:

```ts
import { assemble } from "@mit-sdg/sync-engine/assembly";
import { operationsRoomConcepts, vocabulary } from "./concept-set.ts";
import * as composition from "./composition.ts";

export function assembleOperationsRoom() {
  return assemble({
    vocabulary,
    instances: operationsRoomConcepts.implementations(),
    composition,
  });
}
```

## Generate and call the boundary

Create `generated.config.ts`. The generator will derive the assembled read-back
in `generated/operations-room.md` and the typed boundary contract in
`generated/wire.ts` from the assembly:

```ts
import { assembleOperationsRoom } from "./src/assembly.ts";

export default {
  assemble: assembleOperationsRoom,
  directory: new URL("./generated/", import.meta.url),
  specification: "operations-room.md",
  title: "Operations room",
  wire: "wire.ts",
  wireBanner: "// Generated by sync-engine from the Operations room assembly. Do not edit.",
  wireName: "OperationsRoomWire",
  wireVocabulary: { from: "../src/concept-set.ts", export: "vocabulary" },
};
```

Create `src/edge.ts`. It puts the standard gateway in front of the assembly:

```ts
import { createGateway } from "@mit-sdg/sync-engine/boundary";
import type { OperationsRoomWire } from "../generated/wire.ts";
import { assembleOperationsRoom } from "./assembly.ts";

export function buildOperationsRoom() {
  const application = assembleOperationsRoom();
  const gateway = createGateway<OperationsRoomWire>({ application });
  return { application, gateway };
}
```

Create `src/scenario.ts`. It calls that gateway through the generated wire
contract:

```ts
import { createLocalClient } from "@mit-sdg/sync-engine/client";
import type { OperationsRoomWire } from "../generated/wire.ts";
import { buildOperationsRoom } from "./edge.ts";

const { gateway } = buildOperationsRoom();
const operations = createLocalClient<OperationsRoomWire>({ invoker: gateway });

const opened = await operations.rooms.open({ name: "Checkout latency" });
if ("error" in opened) throw new Error(String(opened.error));
const result = await operations.rooms.get({ room: opened.room });
if ("error" in result) throw new Error(String(result.error));
if (result.dashboard.mitigation !== "investigate") {
  throw new Error("The room did not receive its initial mitigation.");
}
console.log(JSON.stringify(result.dashboard));
```

## Run the complete slice

Generate, typecheck, run the principle, and start the scenario in that order:

```sh
bun run generate
bun run typecheck
bun run principle
bun run start
```

The final command prints one room whose mitigation is `investigate`. The
[shipped operations room](../../examples/operations-room/README.md) generalizes
the walkthrough's Mitigating behavior into Selecting, so the same behavior can
choose any item within any scope. It continues the slice with responders,
selectable reaction packs, swappable policy, alerts, discussion, and the
complete dashboard.
