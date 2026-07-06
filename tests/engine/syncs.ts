/* Sync declarations for tests, designed to be clean + declarative */
import { actions, type Frames, type Vars } from "@sync-engine/engine";
import type {
  ButtonConcept,
  CounterConcept,
  ListConcept,
  NotificationConcept,
  RecorderConcept,
} from "./mocks.ts";

export function makeSyncs(
  Button: ButtonConcept,
  Counter: CounterConcept,
  Notification: NotificationConcept,
  List: ListConcept,
  Recorder: RecorderConcept,
) {
  // Simple: button click increments counter
  const ButtonIncrements = (_vars: Vars) => ({
    when: actions([Button.clicked, { kind: "inc" }, {}]),
    then: actions([Counter.increment, {}]),
  });

  // Notify when count crosses threshold (use query; no imperative state)
  const NotifyOn3 = ({ count }: Vars) => ({
    when: actions([Button.clicked, { kind: "inc" }, {}], [Counter.increment, {}, {}]),
    where: (frames: Frames) =>
      frames.query(Counter._getCount, {}, { count }).filter(($) => $[count] === 3),
    then: actions([Notification.notify, { message: "reached 3" }]),
  });

  // Fanout: for every List._items, trigger a record; tests query multiplication
  const FanoutOverList = ({ value, tag }: Vars) => ({
    when: actions([Button.clicked, { kind: "fanout" }, {}]),
    where: (frames: Frames) =>
      frames.query(List._items, {}, { value }).map((frame) => ({
        ...frame,
        [tag]: `v:${String(frame[value])}`,
      })),
    then: actions([Recorder.record, { tag }]),
  });

  // Async query variant to ensure async queries are supported
  const FanoutOverListAsync = ({ value, tag }: Vars) => ({
    when: actions([Button.clicked, { kind: "fanout-async" }, {}]),
    where: async (frames: Frames) => {
      const withValues = await frames.queryAsync(
        List._itemsAsync,
        {},
        {
          value,
        },
      );
      return withValues.map((frame) => ({
        ...frame,
        [tag]: `v:${String(frame[value])}`,
      }));
    },
    then: actions([Recorder.record, { tag }]),
  });

  // Ensure each sync fires once per flow and marks as synced: chain record
  const ChainRecordA = ({ tag, next }: Vars) => ({
    when: actions([Recorder.record, { tag }, {}]),
    where: (frames: Frames) =>
      frames
        // act only on simple tags with no colon to avoid cascades
        .filter(($) => !String($[tag]).includes(":"))
        .map((frame) => ({
          ...frame,
          [next]: `${String(frame[tag])}:a`,
        })),
    then: actions([Recorder.record, { tag: next }]),
  });

  const PreventDoubleFire = ({ tag1, tag2, done }: Vars) => ({
    when: actions([Recorder.record, { tag: tag1 }, {}], [Recorder.record, { tag: tag2 }, {}]),
    where: (frames: Frames) =>
      frames
        // only consider simple base tags, and exact a-suffix pair
        .filter(($) => !String($[tag1]).includes(":"))
        .filter(($) => String($[tag2]) === `${String($[tag1])}:a`)
        .map((frame) => ({
          ...frame,
          [done]: `${String(frame[tag1])}:done`,
        })),
    then: actions([Recorder.record, { tag: done }]),
  });

  return {
    ButtonIncrements,
    NotifyOn3,
    FanoutOverList,
    FanoutOverListAsync,
    ChainRecordA,
    PreventDoubleFire,
  } as const;
}
