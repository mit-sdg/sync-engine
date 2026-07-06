/**
 * Golden test app — synchronization rules for the Todo application.
 *
 * Every sync follows the `when → where → then` pattern:
 *  - when   — action patterns matched against the journal
 *  - where  — optional pure transform over matched frames
 *  - then   — actions to dispatch per surviving frame
 */

import { actions, type Vars } from "@sync-engine/engine";
import type { AuditConcept, TodoConcept } from "./concepts.ts";

export function makeTodoSyncs(Todo: TodoConcept, Audit: AuditConcept) {
  /**
   * When a todo is created, record an audit entry with the todo's data.
   */
  const CreateRecordsAudit = ({ entity }: Vars) => ({
    when: actions([Todo.create, { id: entity }, {}]),
    then: actions([
      Audit.record,
      {
        id: entity,
        event: "TODO_CREATED",
        targetId: entity,
        payload: entity,
      },
    ]),
  });

  /**
   * When a todo is completed (successfully), audit it.
   */
  const CompleteRecordsAudit = ({ id: todoId }: Vars) => ({
    when: actions([Todo.complete, { id: todoId }, { id: todoId }]),
    then: actions([
      Audit.record,
      {
        id: todoId,
        event: "TODO_COMPLETED",
        targetId: todoId,
        payload: todoId,
      },
    ]),
  });

  /**
   * When a todo is deleted, audit the event.
   */
  const DeleteRecordsAudit = ({ id: todoId }: Vars) => ({
    when: actions([Todo.delete, { id: todoId }, {}]),
    then: actions([
      Audit.record,
      {
        id: todoId,
        event: "TODO_DELETED",
        targetId: todoId,
        payload: todoId,
      },
    ]),
  });

  return {
    CreateRecordsAudit,
    CompleteRecordsAudit,
    DeleteRecordsAudit,
  } as const;
}
