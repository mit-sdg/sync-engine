/**
 * Golden test app — a small but realistic Todo application built with the
 * sync-engine concepts + reactions pattern.
 *
 * Concepts:
 *  - TodoConcept     — persists tasks (title, completed, created at)
 *  - AuditConcept    — records every meaningful event in an immutable log
 *
 * Reactions:
 *  - CreateRecordsAudit  — when a todo is created, audit it
 *  - CompleteRecordsAudit — when a todo is completed, audit it
 *  - DeleteRecordsAudit   — when a todo is deleted, audit it
 *
 * This self-contained golden fixture uses internal contracts to test engine
 * integration. It is test support, not a public authoring example.
 */

import { Refuse } from "@sync-engine/internal/reactions";
import type { Empty, OutcomeContracts } from "@sync-engine/internal/reactions";

// ── TodoConcept ──────────────────────────────────────────

export interface TodoItem {
  id: string;
  title: string;
  completed: boolean;
  createdAt: Date;
}

export interface CreateTodoInput {
  id: string;
  title: string;
}

export interface CompleteTodoInput {
  id: string;
}

export interface DeleteTodoInput {
  id: string;
}

export class TodoConcept {
  static readonly outcomes: OutcomeContracts = {
    complete: { refusals: ["NOT_FOUND"] },
  };

  private todos = new Map<string, TodoItem>();

  create({ id, title }: CreateTodoInput) {
    const todo: TodoItem = {
      id,
      title,
      completed: false,
      createdAt: new Date(),
    };
    this.todos.set(id, todo);
    return todo;
  }

  complete({ id }: CompleteTodoInput) {
    const todo = this.todos.get(id);
    if (!todo) throw new Refuse("NOT_FOUND", { detail: `Todo ${id} not found` });
    todo.completed = true;
    return todo;
  }

  delete({ id }: DeleteTodoInput) {
    const existed = this.todos.has(id);
    this.todos.delete(id);
    return { id, existed };
  }

  // Queries (prefixed with _)
  _getAll(_: Empty): TodoItem[] {
    return [...this.todos.values()];
  }

  _getById({ id }: { id: string }): TodoItem[] {
    const todo = this.todos.get(id);
    return todo ? [todo] : [];
  }

  _getPending(_: Empty): TodoItem[] {
    return [...this.todos.values()].filter((t) => !t.completed);
  }
}

// ── AuditConcept ─────────────────────────────────────────

export interface AuditEntry {
  id: string;
  event: string;
  targetId: string;
  payload: Record<string, unknown>;
  timestamp: Date;
}

export class AuditConcept {
  readonly log: AuditEntry[] = [];

  record(entry: AuditEntry) {
    this.log.push(entry);
    return entry;
  }

  _getLog(_: Empty): AuditEntry[] {
    return [...this.log];
  }

  _getByTarget({ targetId }: { targetId: string }): AuditEntry[] {
    return this.log.filter((e) => e.targetId === targetId);
  }
}
