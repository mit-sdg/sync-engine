import { describe, expect, test } from "vite-plus/test";
import { DiscussionAlreadyOpen, DiscussionNotOpen } from "./errors.ts";
import { DiscussingConcept } from "./discussing.ts";

const ids = (...values: string[]) => {
  const remaining = [...values];
  return () => remaining.shift() ?? "unexpected";
};

describe("Discussing", () => {
  test("its principle: open, respond in order, close, refuse", () => {
    const discussing = new DiscussingConcept(ids("discussion", "first", "second", "reopened"));
    expect(discussing.open({ subject: "proposal" })).toEqual({ discussion: "discussion" });
    expect(discussing._openFor({ subject: "proposal" })).toEqual([{ discussion: "discussion" }]);
    const repeatedOpen = () => discussing.open({ subject: "proposal" });
    expect(repeatedOpen).toThrow(DiscussionAlreadyOpen);
    expect(repeatedOpen).toThrow("This subject already has an open discussion.");
    discussing.respond({ discussion: "discussion", author: "Sol", text: "First" });
    discussing.respond({ discussion: "discussion", author: "Mina", text: "Second" });
    expect(discussing._responses({ discussion: "discussion" })).toEqual([
      { response: "first", discussion: "discussion", author: "Sol", text: "First" },
      { response: "second", discussion: "discussion", author: "Mina", text: "Second" },
    ]);
    expect(discussing.close({ discussion: "discussion" })).toEqual({});
    expect(discussing._openFor({ subject: "proposal" })).toEqual([]);
    const responseAfterClose = () =>
      discussing.respond({ discussion: "discussion", author: "Sol", text: "Later" });
    expect(responseAfterClose).toThrow(DiscussionNotOpen);
    expect(responseAfterClose).toThrow("This discussion is not open.");
    const repeatedClose = () => discussing.close({ discussion: "discussion" });
    expect(repeatedClose).toThrow(DiscussionNotOpen);
    expect(repeatedClose).toThrow("This discussion is not open.");
    expect(discussing.open({ subject: "proposal" })).toEqual({ discussion: "reopened" });
  });

  test("unknown discussions are not open", () => {
    const discussing = new DiscussingConcept(ids());
    const closeMissing = () => discussing.close({ discussion: "missing" });
    expect(closeMissing).toThrow(DiscussionNotOpen);
    expect(closeMissing).toThrow("This discussion is not open.");
    expect(discussing._openFor({ subject: "missing" })).toEqual([]);
  });
});
