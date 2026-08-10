import { describe, expect, test } from "vite-plus/test";
import { CommentAuthorMismatch, CommentingConcept, CommentNotFound } from "./commenting.ts";

function identities(...values: string[]) {
  return () => {
    const value = values.shift();
    if (value === undefined) throw new Error("No deterministic identity remains.");
    return value;
  };
}

describe("Commenting", () => {
  test("its principle: attach external identities in order and enforce retraction authority", () => {
    const commenting = new CommentingConcept(identities("first", "second"));
    commenting.add({ target: "topic-7", author: "Ari", content: "reply-42" });
    commenting.add({ target: "topic-7", author: "Bo", content: "reply-43" });
    expect(commenting._for({ target: "topic-7" })).toEqual([
      { comment: "first", author: "Ari", content: "reply-42" },
      { comment: "second", author: "Bo", content: "reply-43" },
    ]);
    expect(commenting._for({ target: "topic-8" })).toEqual([]);

    const wrongAuthor = () => commenting.retract({ comment: "first", author: "Bo" });
    expect(wrongAuthor).toThrow(CommentAuthorMismatch);
    expect(wrongAuthor).toThrow("Only the comment author may retract it.");
    expect(commenting._for({ target: "topic-7" })).toHaveLength(2);

    expect(commenting.retract({ comment: "first", author: "Ari" })).toEqual({ comment: "first" });
    const repeated = () => commenting.retract({ comment: "first", author: "Ari" });
    expect(repeated).toThrow(CommentNotFound);
    expect(repeated).toThrow("There is no such comment.");
    expect(commenting._for({ target: "topic-7" })).toEqual([
      { comment: "second", author: "Bo", content: "reply-43" },
    ]);
  });
});
