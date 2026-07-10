import { act, type Vars, when } from "@sync-engine/engine";
import type { FocusConcept, HistoryConcept, WorkConcept } from "./concepts.ts";

export function makeStitchSyncs(Work: WorkConcept, Focus: FocusConcept, History: HistoryConcept) {
  const RecordAdded = ({ item, title }: Vars) =>
    when(Work.add, {}, { item, title }).then(act(History.record, { verb: "added", item, title }));

  const BeginFocus = ({ item }: Vars) =>
    when(Work.activate, {}, { item }).then(act(Focus.begin, { item }));

  const RecordStarted = ({ item, title }: Vars) =>
    when(Work.activate, {}, { item, title }).then(
      act(History.record, { verb: "started", item, title }),
    );

  const PauseDisplacedWork = ({ previous, title }: Vars) =>
    when(Focus.begin, {}, { previous })
      .where((frames) =>
        frames.filter(($) => Boolean($[previous])).query(Work._get, { id: previous }, { title }),
      )
      .then(act(Work.pause, { id: previous }));

  const RecordPaused = ({ item, title }: Vars) =>
    when(Work.pause, { id: item }, { item, title, changed: true }).then(
      act(History.record, { verb: "paused", item, title }),
    );

  const FinishFocusedWork = ({ item }: Vars) =>
    when(Work.complete, {}, { item })
      .where((frames) => frames.query(Focus._current, {}, { item }))
      .then(act(Focus.finish, { item }));

  const RecordCompleted = ({ item, title }: Vars) =>
    when(Work.complete, {}, { item, title }).then(
      act(History.record, { verb: "completed", item, title }),
    );

  return {
    RecordAdded,
    BeginFocus,
    RecordStarted,
    PauseDisplacedWork,
    RecordPaused,
    FinishFocusedWork,
    RecordCompleted,
  };
}
