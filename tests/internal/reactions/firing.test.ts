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
      marked: false,
    };
    book.mark(fill);
    expect(book.hasConsumed("ask", "Notify")).toBe(true);
    book.record(fill);
    expect(store.hasConsumed("ask", "Notify")).toBe(true);
    expect(store.firingsByReaction("Notify")[0]).toMatchObject({ consumed: ["ask"] });
  });

  test("mark is idempotent", () => {
    const store = new MemoryStore();
    const book = new FiringBook(store);
    const fill: FiringFill = {
      reaction: "Notify",
      flow: "flow",
      whenIds: ["ask"],
      bindings: { item: "a" },
      produced: [],
      marked: false,
    };
    book.mark(fill);
    book.mark(fill);
    expect(book.hasConsumed("ask", "Notify")).toBe(true);
    book.unmark(fill);
    expect(book.hasConsumed("ask", "Notify")).toBe(false);
  });

  test("record releases the in-flight mark when appending the firing throws", () => {
    const failure = new Error("append failed");
    const store = new MemoryStore();
    store.append = () => {
      throw failure;
    };
    const book = new FiringBook(store);
    const fill: FiringFill = {
      reaction: "Notify",
      flow: "flow",
      whenIds: ["ask"],
      bindings: { item: "a" },
      produced: [],
      marked: false,
    };
    book.mark(fill);

    expect(() => book.record(fill)).toThrow(failure);
    expect(fill.marked).toBe(false);
    expect(book.hasConsumed("ask", "Notify")).toBe(false);
  });
});
