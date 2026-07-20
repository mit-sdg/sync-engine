import { lineOf } from "@sync-engine/internal/reads/lines";
/* Reaction fixtures for execution tests. Synthetic string-formatting steps
 * use `custom(...)`; application code normally uses named vocabulary
 * computations when it needs serialized output. */
import {
  request,
  custom,
  type Reacting,
  type Vars,
  vocabulary,
  vocabularyComputations,
  when,
} from "@sync-engine/internal/reactions";
import type {
  ButtonConcept,
  CounterConcept,
  ListConcept,
  NotificationConcept,
  RecorderConcept,
} from "./mocks.ts";

/** The tag carries no ":" — it is a root tag, not one derived by a chain. */
const words = vocabulary({
  concepts: {},
  computations: {
    rootTag: ({ tag }) => !String(tag).includes(":"),
    derivedFrom: ({ tag1, tag2 }) => String(tag2) === `${String(tag1)}:a`,
  },
});
const { rootTag, derivedFrom } = words.computations;

export function registerReactionComputations(reacting: Reacting): void {
  reacting.registerComputations(vocabularyComputations(words));
}

export function makeReactions(
  Button: ButtonConcept,
  Counter: CounterConcept,
  Notification: NotificationConcept,
  List: ListConcept,
  Recorder: RecorderConcept,
) {
  const ButtonIncrements = (_vars: Vars) =>
    when(Button.clicked, { kind: "inc" }, {}).then(request(Counter.increment, {}));

  const NotifyOn3 = (_vars: Vars) =>
    when([
      [Button.clicked, { kind: "inc" }],
      [Counter.increment, {}],
    ])
      .where(lineOf({ query: Counter._getCount }, {}).is({ count: 3 }))
      .then(request(Notification.notify, { message: "reached 3" }));

  const FanoutOverList = ({ value, tag }: Vars) =>
    when(Button.clicked, { kind: "fanout" }, {})
      .where(
        lineOf({ query: List._items }, {}).is({ value }),
        custom((v) => `v:${String(v)}`, [value], [tag]),
      )
      .then(request(Recorder.record, { tag }));

  const FanoutOverListAsync = ({ value, tag }: Vars) =>
    when(Button.clicked, { kind: "fanout-async" }, {})
      .where(
        lineOf({ query: List._itemsAsync }, {}).is({ value }),
        custom(async (v) => `v:${String(v)}`, [value], [tag]),
      )
      .then(request(Recorder.record, { tag }));

  const ChainRecordA = ({ tag, next }: Vars) =>
    when(Recorder.record, { tag }, {})
      .where(
        rootTag({ tag }),
        custom((t) => `${String(t)}:a`, [tag], [next]),
      )
      .then(request(Recorder.record, { tag: next }));

  const PreventDoubleFire = ({ tag1, tag2, done }: Vars) =>
    when([
      [Recorder.record, { tag: tag1 }],
      [Recorder.record, { tag: tag2 }],
    ])
      .where(
        rootTag({ tag: tag1 }),
        derivedFrom({ tag1, tag2 }),
        custom((t) => `${String(t)}:done`, [tag1], [done]),
      )
      .then(request(Recorder.record, { tag: done }));

  return {
    ButtonIncrements,
    NotifyOn3,
    FanoutOverList,
    FanoutOverListAsync,
    ChainRecordA,
    PreventDoubleFire,
  } as const;
}
