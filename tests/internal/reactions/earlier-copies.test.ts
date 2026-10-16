/** `earlier(...)` matches and binds from the reaction's own copy of each record. */
import { describe, expect, test } from "vite-plus/test";
import { Refuse, vocabulary } from "@sync-engine/advanced";
import { endpoint, receive, respond } from "@sync-engine/boundary";
import { earlier, reaction, when } from "@sync-engine/language";
import { assemble } from "@sync-engine/internal/boundary/assembly/assemble";
import type { Vars } from "@sync-engine/internal/reactions/types";
import { quietReacting } from "../../utils/reacting.ts";

type Order = { name: string; tags: string[] };

class ShopConcept {
  place({ order }: { order: Order }) {
    return { name: order.name };
  }
}
/** Tidies its input in place: careless, but ordinary JavaScript. */
class TidyConcept {
  tidy({ order }: { order: Order }) {
    order.name = order.name.trim().toUpperCase();
    order.tags.push("tidied");
    return { done: true };
  }
}
class NudgeConcept {
  nudge({ kind }: { kind: string }) {
    return { kind };
  }
}
class RecorderConcept {
  seen: string[] = [];
  same: boolean[] = [];
  record({ tag }: { tag: string }) {
    this.seen.push(tag);
    return { tag };
  }
  compare({ first, second }: { first: unknown; second: unknown }) {
    this.same.push(first === second);
    return {};
  }
}
/** Returns its own state object, as a concept answering from memory may. */
class ShelfConcept {
  rows: Order[] = [{ name: "kept", tags: [] }];
  take(_: Record<string, never>) {
    return { row: this.rows[0] };
  }
}

const words = vocabulary({
  concepts: {
    Shop: ShopConcept,
    Tidy: TidyConcept,
    Nudge: NudgeConcept,
    Recorder: RecorderConcept,
    Shelf: ShelfConcept,
  },
  computations: {},
});
const { Shop, Tidy, Nudge, Recorder, Shelf } = words.concepts;

function build(composition: Record<string, unknown>) {
  const instances = {
    Shop: new ShopConcept(),
    Tidy: new TidyConcept(),
    Nudge: new NudgeConcept(),
    Recorder: new RecorderConcept(),
    Shelf: new ShelfConcept(),
  };
  return {
    assembly: assemble({ vocabulary: words, instances, composition } as never),
    instances,
  };
}

describe("earlier binds the reaction's own copies", () => {
  test("an action that tidies a value bound through earlier leaves the record as it was", async () => {
    const { assembly, instances } = build({
      Ask: reaction(({ order }: Vars) =>
        when(Shop.place({ order }).responds()).then(Nudge.nudge({ kind: "go" })),
      ),
      Tidy: reaction(({ order }: Vars) =>
        when(Nudge.nudge({ kind: "go" }).responds())
          .where(earlier(Shop.place, { order }))
          .then(Tidy.tidy({ order })),
      ),
      Check: reaction((_: Vars) =>
        when(Tidy.tidy({}).responds())
          .where(earlier(Shop.place, { order: { name: " a ", tags: [] } }))
          .then(Recorder.record({ tag: "original still seen" })),
      ),
    });
    await (assembly as any).concepts.Shop.place({ order: { name: " a ", tags: [] } });
    await assembly.whenIdle();
    expect(instances.Recorder.seen).toEqual(["original still seen"]);
  });

  test("a later stage of an endpoint answers after an earlier stage tidied the request's value", async () => {
    const TidyMid = endpoint("/tidy/mid", ({ order }: Vars) =>
      receive({ order })
        .then(Nudge.nudge({ kind: "one" }).responds())
        .then(Tidy.tidy({ order }).responds())
        .then(Nudge.nudge({ kind: "two" }).responds())
        .then(respond({ order })),
    );
    const { assembly } = build({ TidyMid });
    const sent = { name: " a ", tags: [] as string[] };
    const result = await assembly.invoker.invoke("/tidy/mid" as never, { order: sent } as never, {
      timeoutMs: 2_000,
    });
    await assembly.whenIdle();
    expect(result).toEqual({ ok: true, value: { order: { name: " a ", tags: [] } } });
    expect(sent).toEqual({ name: " a ", tags: [] });
  });

  test("a value another concept returned, bound through earlier, cannot reach that concept's state", async () => {
    const { assembly, instances } = build({
      Go: reaction((_: Vars) => when(Shelf.take({}).responds()).then(Nudge.nudge({ kind: "go" }))),
      Tidy: reaction(({ row }: Vars) =>
        when(Nudge.nudge({ kind: "go" }).responds())
          .where(earlier(Shelf.take, {}, { row }))
          .then(Tidy.tidy({ order: row })),
      ),
    });
    await (assembly as any).concepts.Shelf.take({});
    await assembly.whenIdle();
    expect(instances.Shelf.rows).toEqual([{ name: "kept", tags: [] }]);
  });

  test("two earlier lines binding one stored value share one copy", async () => {
    const { assembly, instances } = build({
      Ask: reaction(({ order }: Vars) =>
        when(Shop.place({ order }).responds()).then(Nudge.nudge({ kind: "go" })),
      ),
      Compare: reaction(({ first, second }: Vars) =>
        when(Nudge.nudge({ kind: "go" }).responds())
          .where(earlier(Shop.place, { order: first }), earlier(Shop.place, { order: second }))
          .then(Recorder.compare({ first, second })),
      ),
    });
    await (assembly as any).concepts.Shop.place({ order: { name: "a", tags: [] } });
    await assembly.whenIdle();
    expect(instances.Recorder.same).toEqual([true]);
  });

  test("refusal data bound through earlier cannot reach the refusing concept's state", async () => {
    class RefusingShelfConcept {
      rows: Order[] = [{ name: " kept ", tags: [] }];
      take(_: Record<string, never>) {
        throw new Refuse("EMPTY", { row: this.rows[0] });
      }
    }
    const reacting = quietReacting();
    const shelf = new RefusingShelfConcept();
    const concepts = reacting.instrument({
      Shelf: shelf,
      Nudge: new NudgeConcept(),
      Tidy: new TidyConcept(),
    });
    reacting.registerReactions([
      {
        name: "Go",
        when: [
          {
            kind: "action",
            concept: "RefusingShelf",
            action: "take",
            posture: "refused",
            input: {},
            output: { error: "EMPTY" },
          },
        ],
        where: [],
        then: [{ kind: "request", concept: "Nudge", action: "nudge", input: { kind: "go" } }],
      },
      {
        name: "Tidy",
        when: [
          {
            kind: "action",
            concept: "Nudge",
            action: "nudge",
            posture: "returned",
            input: { kind: "go" },
            output: {},
          },
        ],
        where: [
          {
            op: "earlier",
            when: {
              kind: "action",
              concept: "RefusingShelf",
              action: "take",
              posture: "refused",
              input: {},
              output: { row: { $var: "row" } },
            },
          },
        ],
        then: [
          { kind: "request", concept: "Tidy", action: "tidy", input: { order: { $var: "row" } } },
        ],
      },
    ] as never);
    await concepts.Shelf.take({});
    expect(shelf.rows).toEqual([{ name: " kept ", tags: [] }]);
  });
  test("two earlier lines matching one record both match, even on a value equal only to itself", async () => {
    const { assembly, instances } = build({
      Ask: reaction(({ order }: Vars) =>
        when(Shop.place({ order }).responds()).then(Nudge.nudge({ kind: "go" })),
      ),
      Twice: reaction(({ order }: Vars) =>
        when(Nudge.nudge({ kind: "go" }).responds())
          .where(earlier(Shop.place, { order }), earlier(Shop.place, { order }))
          .then(Recorder.record({ tag: "twice" })),
      ),
    });
    const order = { name: "a", tags: [], at: new Date(Number.NaN) };
    await (assembly as any).concepts.Shop.place({ order });
    await assembly.whenIdle();
    expect(instances.Recorder.seen).toEqual(["twice"]);
  });
});
