import { describe, expect, test } from "vite-plus/test";
import { Reacting } from "@sync-engine/internal/reactions/runtime/reacting.ts";
import { createEngine } from "@sync-engine/internal/reactions/engine.ts";
import { vocabulary } from "@sync-engine/advanced";
import { each, former, when } from "@sync-engine/language";

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
    expect(reacting.Action.store.firingsByReaction("Notify")).toHaveLength(1);
  });

  test("createEngine with occurrence options returns an Engine", () => {
    const engine = createEngine({ retention: "keepAll", logSink: { append() {} } });
    expect(engine.instrument).instanceOf(Function);
    expect(engine.register).instanceOf(Function);
    expect(engine.logging).toBeDefined();
  });

  test("createEngine form evaluation reuses manual query caches", async () => {
    class Reading {
      calls = 0;

      touch(_: Record<string, never>) {
        return {};
      }

      _rows(_: Record<string, never>) {
        this.calls += 1;
        return [{ value: this.calls }];
      }
    }
    const { Reading: ReadingRef } = vocabulary({ concepts: { Reading } }).concepts;
    const snapshot = former("manual snapshot ()", (_input, { value }) =>
      each(ReadingRef._rows({}).is({ value })).form({ value }),
    );
    const engine = createEngine();
    const ReadingConcept = engine.instrumentConcept(new Reading());

    expect(await engine.form(snapshot({}))).toEqual([{ value: 1 }]);
    expect(await engine.form(snapshot({}))).toEqual([{ value: 1 }]);
    expect(ReadingConcept.calls).toBe(1);

    await ReadingConcept.touch({});
    expect(await engine.form(snapshot({}))).toEqual([{ value: 2 }]);
  });
});
