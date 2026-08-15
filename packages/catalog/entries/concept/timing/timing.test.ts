import { assemble } from "@mit-sdg/sync-engine/assembly";
import { vocabulary } from "@mit-sdg/sync-engine/advanced";
import { reaction, when } from "@mit-sdg/sync-engine/language";
import { expect, test } from "vite-plus/test";
import { TimingConcept } from "./timing.ts";

class StartingConcept {
  start(_input: Record<string, never>) {
    return {};
  }
}

class RecordingConcept {
  readonly times: Date[] = [];

  record({ time }: { time: Date }) {
    this.times.push(time);
    return {};
  }
}

const testVocabulary = vocabulary({
  concepts: {
    Timing: { class: TimingConcept, queries: { _now: "one" } },
    Starting: StartingConcept,
    FirstRecording: RecordingConcept,
    SecondRecording: RecordingConcept,
  },
});
const { FirstRecording, SecondRecording, Starting, Timing } = testVocabulary.concepts;
const CaptureTime = reaction(({ time }) =>
  when(Starting.start({}).responds())
    .where(Timing._now({}).is({ time }))
    .then(FirstRecording.record({ time }))
    .then(SecondRecording.record({ time })),
);

test("Timing answers the configured wall-clock reader", () => {
  const t1 = new Date("2026-01-01T00:00:00.000Z");
  const t2 = new Date("2026-01-01T00:00:01.000Z");
  let current = t1;
  const timing = new TimingConcept(() => current);

  expect(timing.read({})).toEqual({ time: t1 });
  expect(timing._now()).toEqual({ time: t1 });
  current = t2;
  expect(timing.read({})).toEqual({ time: t2 });
  expect(timing._now()).toEqual({ time: t2 });
});

test("Timing binds one read for separate effects without query memoization", async () => {
  const time = new Date("2026-01-01T00:00:00.000Z");
  let reads = 0;
  const timing = new TimingConcept(() => {
    reads += 1;
    return time;
  });
  const first = new RecordingConcept();
  const second = new RecordingConcept();
  const application = assemble({
    vocabulary: testVocabulary,
    instances: {
      Timing: timing,
      Starting: new StartingConcept(),
      FirstRecording: first,
      SecondRecording: second,
    },
    composition: { CaptureTime },
    queryCache: "none",
  });

  await application.concepts.Starting.start({});
  expect(reads).toBe(1);
  expect(first.times).toEqual([time]);
  expect(second.times).toEqual([time]);
});
