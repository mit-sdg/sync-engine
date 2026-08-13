import { describe, expect, test } from "vite-plus/test";
import { InvalidPostContent, PostingConcept } from "../../src/concepts/Posting.ts";

function identities(...values: string[]) {
  return () => {
    const value = values.shift();
    if (value === undefined) throw new Error("No deterministic identity remains.");
    return value;
  };
}

describe("Posting", () => {
  test("its principle: publish authored strings in order and refuse empty content", () => {
    const posting = new PostingConcept(identities("first", "second"));
    expect(posting.publish({ author: "Ari", content: "First post" })).toEqual({ post: "first" });
    expect(posting.publish({ author: "Bo", content: "Second post" })).toEqual({ post: "second" });
    expect(posting._all({})).toEqual([
      { post: "first", author: "Ari", content: "First post" },
      { post: "second", author: "Bo", content: "Second post" },
    ]);
    expect(posting._get({ post: "first" })).toEqual([{ author: "Ari", content: "First post" }]);
    const invalid = () => posting.publish({ author: "Ari", content: "   " });
    expect(invalid).toThrow(InvalidPostContent);
    expect(invalid).toThrow("Post content must not be blank and must be at most 500 characters.");
    expect(posting._all({})).toHaveLength(2);
    expect(() => posting.publish({ author: "Ari", content: "x".repeat(501) })).toThrow(
      InvalidPostContent,
    );
    expect(posting._all({})).toHaveLength(2);
    expect(posting._get({ post: "missing" })).toEqual([]);
  });
});
