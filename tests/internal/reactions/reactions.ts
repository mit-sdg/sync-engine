/* Reaction fixtures for execution tests. Synthetic string-formatting steps
 * use `custom(...)`; application code normally uses named vocabulary
 * computations when it needs serialized output. */
import { vocabulary } from "@sync-engine/language";
import { custom } from "@sync-engine/internal/reads/where-ops";
import { vocabularyComputations } from "@sync-engine/internal/reactions/authoring/refs";
import type { Reacting } from "@sync-engine/internal/reactions/runtime/reacting";
import { earlier, when } from "@sync-engine/language";
import type { Vars } from "@sync-engine/internal/reactions/types";
import { mockRefs } from "./mocks.ts";

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

export function makeReactions() {
  const { Button, Counter, Notification, List, Recorder } = mockRefs;
  const ButtonIncrements = (_vars: Vars) =>
    when(Button.clicked({ kind: "inc" }).responds()).then(Counter.increment({}));

  const NotifyOn3 = (_vars: Vars) =>
    when(Counter.increment({}).responds())
      .where(earlier(Button.clicked, { kind: "inc" }), Counter._getCount({}).is({ count: 3 }))
      .then(Notification.notify({ message: "reached 3" }));

  const FanoutOverList = ({ value, tag }: Vars) =>
    when(Button.clicked({ kind: "fanout" }).responds())
      .where(
        List._items({}).is({ value }),
        custom((v) => `v:${String(v)}`, [value], [tag]),
      )
      .then(Recorder.record({ tag }));

  const FanoutOverListAsync = ({ value, tag }: Vars) =>
    when(Button.clicked({ kind: "fanout-async" }).responds())
      .where(
        List._itemsAsync({}).is({ value }),
        custom(async (v) => `v:${String(v)}`, [value], [tag]),
      )
      .then(Recorder.record({ tag }));

  const ChainRecordA = ({ tag, next }: Vars) =>
    when(Recorder.record({ tag }).responds())
      .where(
        rootTag({ tag }),
        custom((t) => `${String(t)}:a`, [tag], [next]),
      )
      .then(Recorder.record({ tag: next }));

  const PreventDoubleFire = ({ tag1, tag2, done }: Vars) =>
    when(Recorder.record({ tag: tag2 }).responds())
      .where(
        earlier(Recorder.record, { tag: tag1 }),
        rootTag({ tag: tag1 }),
        derivedFrom({ tag1, tag2 }),
        custom((t) => `${String(t)}:done`, [tag1], [done]),
      )
      .then(Recorder.record({ tag: done }));

  return {
    ButtonIncrements,
    NotifyOn3,
    FanoutOverList,
    FanoutOverListAsync,
    ChainRecordA,
    PreventDoubleFire,
  } as const;
}
