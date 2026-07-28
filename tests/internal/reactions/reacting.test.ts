import { describe, expect, test } from "vite-plus/test";
import { Reacting } from "@sync-engine/internal/reactions/runtime/reacting.ts";
import { createEngine } from "@sync-engine/internal/reactions/engine.ts";
import { MemoryStore } from "@sync-engine/internal/reactions/runtime/log-store.ts";
import { vocabulary, when } from "@sync-engine/language";

describe("Reacting interpreter loop", () => {
  test("fires a registered consequence exactly once", async () => {
    class Source {
      open(_input: Record<string, never>) {
        return {};
      }
    }
    class Sink {
      seen = 0;
      note(_input: Record<string, never>) {
        this.seen += 1;
        return {};
      }
    }
    const { Source: SourceRef, Sink: SinkRef } = vocabulary({
      concepts: { Source, Sink },
    }).concepts;
    const reacting = new Reacting();
    const SourceConcept = reacting.instrumentConcept(new Source());
    const sink = new Sink();
    reacting.instrumentConcept(sink);
    reacting.register({
      Notify: () => when(SourceRef.open({}).responds()).then(SinkRef.note({})),
    });
    await SourceConcept.open({});
    expect(sink.seen).toBe(1);
    expect(reacting._getFirings("Notify")).toHaveLength(1);
  });

  test("does not resolve inherited frame properties as consequence bindings", () => {
    class Sink {
      note(_input: { value: unknown }) {
        return {};
      }
    }
    const { Sink: SinkRef } = vocabulary({ concepts: { Sink } }).concepts;
    const reacting = new Reacting();
    reacting.instrumentConcept(new Sink());

    for (const name of ["constructor", "toString", "__proto__"]) {
      const consequence = SinkRef.note({ value: { $var: name } });
      expect(() => reacting.matchThen(consequence.action, {})).toThrow("is not bound");
    }
  });

  test("createEngine with a LogStore returns an Engine", () => {
    const engine = createEngine(new MemoryStore());
    expect(engine.instrument).instanceOf(Function);
    expect(engine.register).instanceOf(Function);
    expect(engine.logging).toBeDefined();
  });
});
