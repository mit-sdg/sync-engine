import { lineOf } from "@sync-engine/internal/reads/lines";
import {
  request,
  former,
  each,
  view,
  vocabulary,
  where,
  type Vars,
  when,
} from "@sync-engine/internal/reactions";
import { FocusConcept, HistoryConcept, WorkConcept } from "./concepts.ts";

const stitchVocabulary = vocabulary({
  concepts: { Work: { class: WorkConcept }, History: { class: HistoryConcept } },
});
const WorkReads = stitchVocabulary.concepts.Work;
const HistoryReads = stitchVocabulary.concepts.History;

export function makeStitchReactions(
  Work: WorkConcept,
  Focus: FocusConcept,
  History: HistoryConcept,
) {
  // The one standing question the reactions ask: is this item the current focus?
  // Bindings unify, so the already-bound `item` slot makes the read an
  // equality test — is the current focus this item — never a rebinding.
  const hasFocus = view("(item) has focus", ({ item }) =>
    where(lineOf({ query: Focus._current }, {}).is({ item })),
  );
  const RecordAdded = ({ item, title }: Vars) =>
    when(Work.add, {}, { item, title }).then(
      request(History.record, { verb: "added", item, title }),
    );

  const BeginFocus = ({ item }: Vars) =>
    when(Work.activate, {}, { item }).then(request(Focus.begin, { item }));

  const RecordStarted = ({ item, title }: Vars) =>
    when(Work.activate, {}, { item, title }).then(
      request(History.record, { verb: "started", item, title }),
    );

  const PauseDisplacedWork = ({ previous }: Vars) =>
    when(Focus.begin, {}, { previous })
      .where(lineOf({ query: Work._get }, { id: previous }))
      .then(request(Work.pause, { id: previous }));

  const RecordPaused = ({ item, title }: Vars) =>
    when(Work.pause, { id: item }, { item, title, changed: true }).then(
      request(History.record, { verb: "paused", item, title }),
    );

  const FinishFocusedWork = ({ item }: Vars) =>
    when(Work.complete, {}, { item })
      .where(hasFocus({ item }))
      .then(request(Focus.finish, { item }));

  const RecordCompleted = ({ item, title }: Vars) =>
    when(Work.complete, {}, { item, title }).then(
      request(History.record, { verb: "completed", item, title }),
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

/**
 * The read side: every question the CLI asks, declared once as a former and
 * evaluated at the moment of asking. Shaping leaves the app code — the CLI
 * only formats the trees these hand back.
 */
export function makeStitchFormers(
  Work: WorkConcept,
  Focus: FocusConcept,
  _History: HistoryConcept,
) {
  // `stitch list`: the work still in play, in the record's own order.
  const openQueue = former("the open queue ()", ({ id, title, priority, status }) =>
    each(WorkReads._list({}).is({ id, title, priority, status }).is.not({ status: "done" })).form({
      id,
      title,
      priority,
      status,
    }),
  );

  // `stitch list --all`: the same queue, done work included.
  const wholeQueue = former("the whole queue ()", ({ id, title, priority, status }) =>
    each(WorkReads._list({}).is({ id, title, priority, status })).form({
      id,
      title,
      priority,
      status,
    }),
  );

  // `stitch status`: none-or-one focus, and that focus's one work item — the
  // two pick cardinalities composing. No focus leaves every leaf `null`
  // (absence propagates through the second pick); a focus naming a work item
  // that does not exist raises a fault.
  const status = former("the focus (), if any", ({ item, title, priority, status }) =>
    where(
      lineOf({ query: Focus._current }, {}).is({ item }),
      lineOf({ query: Work._get }, { id: item }).is({ title, priority, status }),
    ).form({ item, title, priority, status }),
  );

  // `stitch log`: the whole history, oldest first.
  const history = former("the history ()", ({ sequence, verb, item, title }) =>
    each(HistoryReads._list({}).is({ sequence, verb, item, title }))
      .arranged(sequence)
      .form({ sequence, verb, item, title }),
  );

  return { openQueue, wholeQueue, status, history };
}
