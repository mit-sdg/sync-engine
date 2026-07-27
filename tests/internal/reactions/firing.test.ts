import { describe, expect, test } from "vite-plus/test";
import { FiringBook, type FiringFill } from "@sync-engine/internal/reactions/runtime/firing.ts";
import { MemoryStore } from "@sync-engine/internal/reactions/runtime/log-store.ts";

describe("firing bookkeeping", () => {
  test("an in-flight mark hands consumption to the durable firing record", () => {
    const store = new MemoryStore();
    const book = new FiringBook(store);
    const fill: FiringFill = {
      reaction: "Notify",
      flow: "flow",
      whenIds: ["ask"],
      bindings: { item: "a" },
      produced: ["notification"],
      branches: [],
    };
    const branch = book.newBranch(fill);
    book.mark(branch);
    expect(book.hasConsumed("ask", "Notify")).toBe(true);
    book.record(fill);
    expect(store.hasConsumed("ask", "Notify")).toBe(true);
    expect(book.firings("Notify")[0]).toMatchObject({ consumed: ["ask"] });
  });

  test("unmark decrements count instead of deleting when multiple branches share the same id+reaction", () => {
    const store = new MemoryStore();
    const book = new FiringBook(store);
    const fill: FiringFill = {
      reaction: "Notify",
      flow: "flow",
      whenIds: ["ask"],
      bindings: { item: "a" },
      produced: [],
      branches: [],
    };
    const branch1 = book.newBranch(fill);
    const branch2 = book.newBranch(fill);
    book.mark(branch1);
    book.mark(branch2);
    expect(book.hasConsumed("ask", "Notify")).toBe(true);
    book.unmark(branch1);
    expect(book.hasConsumed("ask", "Notify")).toBe(true);
  });
});
