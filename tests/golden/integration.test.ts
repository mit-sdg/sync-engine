/**
 * Integration tests for the golden Todo application.
 *
 * Demonstrates the full concept + sync pattern in a small, realistic
 * example: create, complete, and delete todos, with every mutation
 * automatically audited by declarative synchronization rules.
 */

import { describe, expect, test } from "bun:test";
import { Logging, SyncConcept } from "@sync-engine/engine";
import { AuditConcept, TodoConcept } from "./concepts";
import { makeTodoSyncs } from "./syncs";

function setup() {
  const Sync = new SyncConcept();
  Sync.logging = Logging.OFF;

  const { Todo, Audit } = Sync.instrument({
    Todo: new TodoConcept(),
    Audit: new AuditConcept(),
  });

  Sync.register(makeTodoSyncs(Todo, Audit));

  return { Todo, Audit };
}

describe("golden: todo app", () => {
  test("creating a todo creates an audit entry", async () => {
    const { Todo, Audit } = setup();

    await Todo.create({ id: "1", title: "Write tests" });

    const todos = Todo._getAll({});
    expect(todos).toHaveLength(1);
    expect(todos[0].title).toBe("Write tests");
    expect(todos[0].completed).toBe(false);

    // Audit entry was created by the sync
    expect(Audit.log).toHaveLength(1);
    expect(Audit.log[0].event).toBe("TODO_CREATED");
    expect(Audit.log[0].targetId).toBe("1");
  });

  test("completing a todo creates an audit entry", async () => {
    const { Todo, Audit } = setup();

    await Todo.create({ id: "1", title: "Ship it" });
    await Todo.complete({ id: "1" });

    const todos = Todo._getAll({});
    expect(todos[0].completed).toBe(true);

    // Two audit entries: create + complete
    expect(Audit.log).toHaveLength(2);
    expect(Audit.log[1].event).toBe("TODO_COMPLETED");
  });

  test("deleting a todo creates an audit entry", async () => {
    const { Todo, Audit } = setup();

    await Todo.create({ id: "1", title: "Delete me" });
    await Todo.delete({ id: "1" });

    const todos = Todo._getAll({});
    expect(todos).toHaveLength(0);

    // Two audit entries: create + delete
    expect(Audit.log).toHaveLength(2);
    expect(Audit.log[1].event).toBe("TODO_DELETED");
  });

  test("completing a non-existent todo returns an error and does NOT audit", async () => {
    const { Todo, Audit } = setup();

    const result = await Todo.complete({ id: "nonexistent" });

    expect(result).toEqual({
      error: "NOT_FOUND",
      detail: "Todo nonexistent not found",
    });

    // The CompleteRecordsAudit sync requires a successful output (id field),
    // and the error output lacks it, so this record is NOT matched.
    // No audit entry is created.
    expect(Audit.log).toHaveLength(0);
  });

  test("multiple actions maintain causal ordering", async () => {
    const { Todo, Audit } = setup();

    await Todo.create({ id: "a", title: "Alpha" });
    await Todo.create({ id: "b", title: "Bravo" });
    await Todo.complete({ id: "a" });
    await Todo.delete({ id: "b" });

    // Each mutation has its own flow; syncs fire per-flow.
    // Total audit entries: 4
    expect(Audit.log).toHaveLength(4);

    const events = Audit.log.map((e) => e.event);
    expect(events).toEqual([
      "TODO_CREATED",
      "TODO_CREATED",
      "TODO_COMPLETED",
      "TODO_DELETED",
    ]);

    // Queries return current state
    const pending = Todo._getPending({});
    expect(pending).toHaveLength(0); // "a" was completed, "b" was deleted

    // getAll returns all non-deleted todos (including completed)
    const all = Todo._getAll({});
    expect(all).toHaveLength(1); // only "a" remains; "b" was deleted
    expect(all[0].id).toBe("a");
    expect(all[0].completed).toBe(true);
  });

  test("queries are cached between mutations", async () => {
    const { Todo } = setup();

    await Todo.create({ id: "1", title: "Cached" });

    const first = Todo._getAll({});
    const second = Todo._getAll({});
    // Same result — cache hit
    expect(first).toBe(second);

    // Mutation invalidates the cache
    await Todo.create({ id: "2", title: "Second" });
    const third = Todo._getAll({});
    expect(third).not.toBe(first);
    expect(third).toHaveLength(2);
  });
});
