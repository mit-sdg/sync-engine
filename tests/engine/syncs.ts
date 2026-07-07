/* Sync declarations for tests, designed to be clean + declarative */
import { act, type Frames, type Vars, when } from "@sync-engine/engine";
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
  const ButtonIncrements = (_vars: Vars) =>
    when(Button.clicked, { kind: "inc" }, {}).then(act(Counter.increment, {}));

  const NotifyOn3 = ({ count }: Vars) =>
    when(Button.clicked, { kind: "inc" }, {})
      .and(Counter.increment, {}, {})
      .where((frames: Frames) =>
        frames.query(Counter._getCount, {}, { count }).filter(($) => $[count] === 3),
      )
      .then(act(Notification.notify, { message: "reached 3" }));

  const FanoutOverList = ({ value, tag }: Vars) =>
    when(Button.clicked, { kind: "fanout" }, {})
      .where((frames: Frames) =>
        frames.query(List._items, {}, { value }).map((frame) => ({
          ...frame,
          [tag]: `v:${String(frame[value])}`,
        })),
      )
      .then(act(Recorder.record, { tag }));

  const FanoutOverListAsync = ({ value, tag }: Vars) =>
    when(Button.clicked, { kind: "fanout-async" }, {})
      .where(async (frames: Frames) => {
        const withValues = await frames.queryAsync(List._itemsAsync, {}, { value });
        return withValues.map((frame) => ({
          ...frame,
          [tag]: `v:${String(frame[value])}`,
        }));
      })
      .then(act(Recorder.record, { tag }));

  const ChainRecordA = ({ tag, next }: Vars) =>
    when(Recorder.record, { tag }, {})
      .where((frames: Frames) =>
        frames
          .filter(($) => !String($[tag]).includes(":"))
          .map((frame) => ({
            ...frame,
            [next]: `${String(frame[tag])}:a`,
          })),
      )
      .then(act(Recorder.record, { tag: next }));

  const PreventDoubleFire = ({ tag1, tag2, done }: Vars) =>
    when(Recorder.record, { tag: tag1 }, {})
      .and(Recorder.record, { tag: tag2 }, {})
      .where((frames: Frames) =>
        frames
          .filter(($) => !String($[tag1]).includes(":"))
          .filter(($) => String($[tag2]) === `${String($[tag1])}:a`)
          .map((frame) => ({
            ...frame,
            [done]: `${String(frame[tag1])}:done`,
          })),
      )
      .then(act(Recorder.record, { tag: done }));

  return {
    ButtonIncrements,
    NotifyOn3,
    FanoutOverList,
    FanoutOverListAsync,
    ChainRecordA,
    PreventDoubleFire,
  } as const;
}
