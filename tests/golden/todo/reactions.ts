/**
 * Golden test app — reaction reactions for the Todo application.
 *
 * Every reaction follows the `when → where → then` pattern:
 *  - when   — action patterns matched against the log
 *  - where  — optional pure transform over matched frames
 *  - then   — actions to dispatch per surviving frame
 */

import { request, type Vars, when } from "@sync-engine/internal/reactions";
import type { AuditConcept, TodoConcept } from "./concepts.ts";

export function makeTodoReactions(Todo: TodoConcept, Audit: AuditConcept) {
  /**
   * When a todo is created, record an audit entry with the todo's data.
   */
  const CreateRecordsAudit = ({ entity }: Vars) =>
    when(Todo.create, { id: entity }, {}).then(
      request(Audit.record, {
        id: entity,
        event: "TODO_CREATED",
        targetId: entity,
        payload: entity,
      }),
    );

  /**
   * When a todo is completed (successfully), audit it.
   */
  const CompleteRecordsAudit = ({ id: todoId }: Vars) =>
    when(Todo.complete, { id: todoId }, { id: todoId }).then(
      request(Audit.record, {
        id: todoId,
        event: "TODO_COMPLETED",
        targetId: todoId,
        payload: todoId,
      }),
    );

  /**
   * When a todo is deleted, audit the event.
   */
  const DeleteRecordsAudit = ({ id: todoId }: Vars) =>
    when(Todo.delete, { id: todoId }, {}).then(
      request(Audit.record, {
        id: todoId,
        event: "TODO_DELETED",
        targetId: todoId,
        payload: todoId,
      }),
    );

  return {
    CreateRecordsAudit,
    CompleteRecordsAudit,
    DeleteRecordsAudit,
  } as const;
}
