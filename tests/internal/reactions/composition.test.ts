/**
 * The live composition contract: register, retire, and replace through the
 * `CompositionBoundary` door, with changes taking effect at their position in
 * the occurrence log.
 */
import { describe, expect, test } from "vite-plus/test";
import { reaction, when } from "@sync-engine/language";
import type { Vars } from "@sync-engine/internal/reactions/types";
import type { PatternIR, ReactionIR } from "@sync-engine/internal/reads/ir";
import { actionNameOf, conceptNameOf } from "@sync-engine/internal/reactions/concepts/introspect";
import type { Reacting } from "@sync-engine/internal/reactions/runtime/reacting";
import { quietReacting } from "../../utils/reacting.ts";
import { ButtonConcept, mockRefs, NotificationConcept, RecorderConcept } from "./mocks.ts";

function setup() {
  const reacting = quietReacting();
  const concepts = reacting.instrument({
    Button: new ButtonConcept(),
    Notification: new NotificationConcept(),
    Recorder: new RecorderConcept(),
  });
  return { reacting, ...concepts };
}

const buttonReturned = {
  kind: "action" as const,
  concept: "Button",
  action: "clicked",
  input: { kind: { $var: "kind" } },
  output: {},
  posture: "returned" as const,
};

/** Watch Button.clicked and record a fixed tag. */
function announce(name: string, tag: string, deferred?: true): ReactionIR {
  return {
    name,
    when: [buttonReturned],
    ...(deferred === true ? { deferred: true as const } : {}),
    where: [],
    then: [{ kind: "request", concept: "Recorder", action: "record", input: { tag } }],
  };
}

/** Watch one CompositionBoundary action and record the subject name it carries. */
function compositionWatcher(name: string, action: "register" | "retire"): ReactionIR {
  return {
    name,
    when: [
      {
        kind: "action" as const,
        concept: "CompositionBoundary",
        action,
        input: { name: { $var: "subject" } },
        output: {},
        posture: "returned" as const,
      },
    ],
    where: [],
    then: [
      {
        kind: "request",
        concept: "Recorder",
        action: "record",
        input: { tag: { $var: "subject" } },
      },
    ],
  };
}

/**
 * Encode built IR as an action input the way `encodeValue` does: every mapping
 * carrying a dollar-prefixed key is wrapped, so a definition's own markers
 * travel as data instead of resolving against the asking reaction's frame.
 */
function asData(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(asData);
  if (typeof value !== "object" || value === null) return value;
  const encoded: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    encoded[key] = asData(item);
  }
  return Object.keys(encoded).some((key) => key.startsWith("$")) ? { $lit: encoded } : encoded;
}

/** Watch one specific Button.clicked kind and ask one composition change in the same flow. */
function compositionAsk(
  name: string,
  action: "retire" | "replace",
  input: Record<string, unknown>,
  kind = "go",
): ReactionIR {
  return {
    name,
    when: [{ ...buttonReturned, input: { kind } }],
    where: [],
    then: [
      {
        kind: "request",
        concept: "CompositionBoundary",
        action,
        input: asData(input) as PatternIR,
      },
    ],
  };
}

function registeredNames(reacting: Reacting): string[] {
  return reacting.exportReactions().reactions.map((entry) => entry.name);
}

describe("the composition door", () => {
  test("register matches occurrences landing after it, never earlier ones", async () => {
    const { reacting, Button, Recorder } = setup();
    await Button.clicked({ kind: "before" });

    const output = await reacting.composition.register({
      name: "Announce",
      reactions: [announce("Announce", "seen")],
    });
    expect(output).toEqual({ name: "Announce", names: ["Announce"] });

    await Button.clicked({ kind: "after" });
    expect(Recorder.order).toEqual(["seen"]);
    expect(registeredNames(reacting)).toContain("Announce");
  });

  test("register refuses a claimed name and leaves the composition unchanged", async () => {
    const { reacting, Button, Recorder } = setup();
    reacting.register({
      Announce: reaction(({ kind }: Vars) =>
        when(mockRefs.Button.clicked({ kind }).responds()).then(
          mockRefs.Recorder.record({ tag: "boot" }),
        ),
      ),
    });

    const refused = await reacting.composition.register({
      name: "Announce",
      reactions: [announce("Announce", "live")],
    });
    expect(refused.error).toBe("ALREADY_REGISTERED");

    await Button.clicked({ kind: "go" });
    expect(Recorder.order).toEqual(["boot"]);
  });

  test("register refuses a shapeless family and an unbindable definition", async () => {
    const { reacting } = setup();
    const empty = await reacting.composition.register({ name: "Empty", reactions: [] });
    expect(empty.error).toBe("NOT_A_FAMILY");

    const unbindable = await reacting.composition.register({
      name: "Ghost",
      reactions: [
        {
          name: "Ghost",
          when: [{ ...buttonReturned, concept: "Missing" }],
          where: [],
          then: [{ kind: "request", concept: "Recorder", action: "record", input: { tag: "x" } }],
        },
      ],
    });
    expect(unbindable.error).toBe("NOT_BINDABLE");
    expect(registeredNames(reacting)).toEqual([]);
  });

  test("retire stops a boot-registered reaction from matching later occurrences", async () => {
    const { reacting, Button, Recorder } = setup();
    reacting.register({
      Announce: reaction(({ kind }: Vars) =>
        when(mockRefs.Button.clicked({ kind }).responds()).then(
          mockRefs.Recorder.record({ tag: "boot" }),
        ),
      ),
    });
    await Button.clicked({ kind: "first" });

    const output = await reacting.composition.retire({ name: "Announce" });
    expect(output).toEqual({ name: "Announce", names: ["Announce"] });

    await Button.clicked({ kind: "second" });
    expect(Recorder.order).toEqual(["boot"]);
    expect(registeredNames(reacting)).toEqual([]);
  });

  test("retire refuses an unknown name, and a stage name names its owning family", async () => {
    const { reacting } = setup();
    reacting.register({
      Chain: reaction(({ kind, tag }: Vars) =>
        when(mockRefs.Button.clicked({ kind }).responds())
          .then(mockRefs.Notification.notify({ message: kind }).responds({ message: tag }))
          .then(mockRefs.Recorder.record({ tag })),
      ),
    });

    const unknown = await reacting.composition.retire({ name: "Nobody" });
    expect(unknown.error).toBe("NOT_REGISTERED");

    const stage = await reacting.composition.retire({ name: "Chain#2" });
    expect(stage.error).toBe("NOT_REGISTERED");
    expect(stage.detail).toContain('"Chain"');
    expect(registeredNames(reacting)).toEqual(["Chain", "Chain#2"]);
  });

  test("retire removes a family with all of its stages", async () => {
    const { reacting } = setup();
    reacting.register({
      Chain: reaction(({ kind, tag }: Vars) =>
        when(mockRefs.Button.clicked({ kind }).responds())
          .then(mockRefs.Notification.notify({ message: kind }).responds({ message: tag }))
          .then(mockRefs.Recorder.record({ tag })),
      ),
    });

    const output = await reacting.composition.retire({ name: "Chain" });
    expect(output).toEqual({ name: "Chain", names: ["Chain", "Chain#2"] });
    expect(registeredNames(reacting)).toEqual([]);
  });

  test("replace swaps the definition under the name in one step", async () => {
    const { reacting, Button, Recorder } = setup();
    await reacting.composition.register({
      name: "Announce",
      reactions: [announce("Announce", "old")],
    });
    await Button.clicked({ kind: "a" });

    const output = await reacting.composition.replace({
      name: "Announce",
      reactions: [announce("Announce", "new")],
    });
    expect(output).toEqual({ name: "Announce", names: ["Announce"], retired: ["Announce"] });

    await Button.clicked({ kind: "b" });
    expect(Recorder.order).toEqual(["old", "new"]);
  });

  test("replace refuses an unregistered name", async () => {
    const { reacting } = setup();
    const refused = await reacting.composition.replace({
      name: "Nobody",
      reactions: [announce("Nobody", "x")],
    });
    expect(refused.error).toBe("NOT_REGISTERED");
  });

  test("composition changes land as occurrences carrying their definitions", async () => {
    const { reacting } = setup();
    await reacting.composition.register({
      name: "Announce",
      reactions: [announce("Announce", "seen")],
    });
    await reacting.composition.retire({ name: "Announce" });

    const landed = [...reacting.Action.actions.values()]
      .filter((record) => conceptNameOf(record.concept) === "CompositionBoundary")
      .map((record) => ({ action: actionNameOf(record.action), input: record.input }));
    expect(landed).toMatchObject([
      { action: "register", input: { name: "Announce", reactions: [{ name: "Announce" }] } },
      { action: "retire", input: { name: "Announce" } },
    ]);
  });

  test("a change is visible to the matching of its own occurrence", async () => {
    const { reacting, Recorder } = setup();
    await reacting.composition.register({
      name: "Watcher",
      reactions: [compositionWatcher("Watcher", "register")],
    });
    expect(Recorder.order).toEqual(["Watcher"]);

    await reacting.composition.register({
      name: "RetireWatcher",
      reactions: [compositionWatcher("RetireWatcher", "retire")],
    });
    Recorder.order.length = 0;
    await reacting.composition.retire({ name: "RetireWatcher" });
    expect(Recorder.order).toEqual([]);
  });

  test("a settlement frontier discards an armed trigger whose reaction was retired", async () => {
    const control = setup();
    await control.reacting.composition.register({
      name: "Deferred",
      reactions: [announce("Deferred", "settled", true)],
    });
    await control.Button.clicked({ kind: "go" });
    expect(control.Recorder.order).toEqual(["settled"]);

    const { reacting, Button, Recorder } = setup();
    await reacting.composition.register({
      name: "Deferred",
      reactions: [announce("Deferred", "settled", true)],
    });
    await reacting.composition.register({
      name: "RetireDeferred",
      reactions: [compositionAsk("RetireDeferred", "retire", { name: "Deferred" })],
    });
    await Button.clicked({ kind: "go" });
    expect(Recorder.order).toEqual([]);
  });

  test("a replacement never inherits the old definition's armed matches", async () => {
    const { reacting, Button, Recorder } = setup();
    await reacting.composition.register({
      name: "Deferred",
      reactions: [announce("Deferred", "old", true)],
    });
    await reacting.composition.register({
      name: "SwapDeferred",
      reactions: [
        compositionAsk("SwapDeferred", "replace", {
          name: "Deferred",
          reactions: [announce("Deferred", "new", true)],
        }),
      ],
    });
    await Button.clicked({ kind: "go" });
    expect(Recorder.order).toEqual([]);

    await Button.clicked({ kind: "again" });
    expect(Recorder.order).toEqual(["new"]);
  });

  test("composition is positional within a flow: later occurrences see the change", async () => {
    const { reacting, Button, Notification, Recorder } = setup();
    reacting.register({
      Announce: reaction(({ message }: Vars) =>
        when(mockRefs.Notification.notify({ message }).responds()).then(
          mockRefs.Recorder.record({ tag: "announced" }),
        ),
      ),
    });
    await Notification.notify({ message: "before" });
    expect(Recorder.order).toEqual(["announced"]);

    await reacting.composition.register({
      name: "RetireAnnounce",
      reactions: [compositionAsk("RetireAnnounce", "retire", { name: "Announce" })],
    });
    await reacting.composition.register({
      name: "NotifyAfterRetire",
      reactions: [
        {
          name: "NotifyAfterRetire",
          when: [
            {
              kind: "action" as const,
              concept: "CompositionBoundary",
              action: "retire",
              input: {},
              output: {},
              posture: "returned" as const,
            },
          ],
          where: [],
          then: [
            {
              kind: "request",
              concept: "Notification",
              action: "notify",
              input: { message: "after" },
            },
          ],
        },
      ],
    });

    await Button.clicked({ kind: "go" });
    expect(Notification.messages).toEqual(["before", "after"]);
    expect(Recorder.order).toEqual(["announced"]);
  });

  test("replaying the composition occurrences reconstructs the composition", async () => {
    const { reacting } = setup();
    await reacting.composition.register({
      name: "Announce",
      reactions: [announce("Announce", "one")],
    });
    await reacting.composition.register({
      name: "Deferred",
      reactions: [announce("Deferred", "held", true)],
    });
    await reacting.composition.replace({
      name: "Announce",
      reactions: [announce("Announce", "two")],
    });
    await reacting.composition.retire({ name: "Deferred" });

    const replayed = setup().reacting;
    for (const record of reacting.Action.actions.values()) {
      if (conceptNameOf(record.concept) !== "CompositionBoundary") continue;
      const operation = actionNameOf(record.action) as "register" | "retire" | "replace";
      await replayed.composition[operation](
        record.input as { name: string; reactions: ReactionIR[] },
      );
    }
    expect(JSON.parse(JSON.stringify(replayed.exportReactions()))).toEqual(
      JSON.parse(JSON.stringify(reacting.exportReactions())),
    );
  });
});
