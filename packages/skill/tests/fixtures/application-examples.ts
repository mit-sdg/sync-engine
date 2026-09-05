import { conceptSet } from "@mit-sdg/sync-engine/assembly";
import { endpoint, receive, respond } from "@mit-sdg/sync-engine/boundary";
import { compute, is, where } from "@mit-sdg/sync-engine/language";

const reminderSet = conceptSet(
  {},
  {
    hasDeadline: ({ dueAt }: { dueAt: string | null }) => dueAt !== null,
    defaultPriority: (_input: Record<string, never>) => "normal",
  },
);

export const CreateReminder = endpoint(
  "/reminders",
  ({ dueAt, hasDeadline, priority }) =>
    receive({ dueAt }).then(
      where(
        compute(reminderSet.computations.hasDeadline, { dueAt }, hasDeadline),
        is.among(hasDeadline, [true]),
      )
        .then(respond({ mode: "scheduled" }))
        .named("with-deadline"),
      where(
        compute(reminderSet.computations.hasDeadline, { dueAt }, hasDeadline),
        is.among(hasDeadline, [false]),
        compute(reminderSet.computations.defaultPriority, {}, priority),
      )
        .then(respond({ mode: "open", priority }))
        .named("without-deadline"),
    ),
  { input: { defaults: { dueAt: null } } },
);
