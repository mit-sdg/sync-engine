import { describe, expect, test } from "vite-plus/test";
import {
  DiscussionAlreadyOpen,
  DiscussionNotOpen,
  InvalidResponseText,
} from "./discussing.shared.ts";
import { DiscussingMemoryConcept } from "./discussing.memory.ts";

const instant = (minute: number) =>
  new Date(`2099-07-20T12:${String(minute).padStart(2, "0")}:00.000Z`);

function thrown(operation: () => unknown): unknown {
  try {
    operation();
  } catch (error) {
    return error;
  }
  return undefined;
}

function rejected(results: PromiseSettledResult<unknown>[]): unknown[] {
  return results.flatMap((result) =>
    result.status === "rejected" ? [result.reason as unknown] : [],
  );
}

describe("Discussing memory", () => {
  test("its principle and refusal contract", () => {
    const ids = ["discussion-1", "response-1", "discussion-2"];
    const discussing = new DiscussingMemoryConcept(() => ids.shift() ?? "unexpected");

    expect(discussing.open({ subject: "p1", at: instant(0) })).toEqual({
      discussion: "discussion-1",
    });
    expect(discussing._openFor({ subject: "p1" })).toEqual([
      { discussion: "discussion-1", openedAt: instant(0) },
    ]);

    const duplicate = thrown(() => discussing.open({ subject: "p1", at: instant(1) }));
    expect(duplicate).toBeInstanceOf(DiscussionAlreadyOpen);
    expect((duplicate as Error).message).toBe("This subject already has an open discussion.");

    for (const text of [" \n\t", "x".repeat(2001)]) {
      const invalid = thrown(() =>
        discussing.respond({
          discussion: "discussion-1",
          author: "Sol",
          text,
          at: instant(2),
        }),
      );
      expect(invalid).toBeInstanceOf(InvalidResponseText);
      expect((invalid as Error).message).toBe(
        "A response must not be blank and must be at most 2000 characters.",
      );
    }
    expect(discussing._responses({ discussion: "discussion-1" })).toEqual([]);

    expect(
      discussing.respond({
        discussion: "discussion-1",
        author: "Sol",
        text: "Proceed in two stages.",
        at: instant(3),
      }),
    ).toEqual({ response: "response-1" });
    expect(discussing._response({ response: "response-1" })).toEqual([
      {
        discussion: "discussion-1",
        author: "Sol",
        text: "Proceed in two stages.",
        addedAt: instant(3),
      },
    ]);

    expect(discussing.close({ discussion: "discussion-1", at: instant(4) })).toEqual({
      discussion: "discussion-1",
    });
    expect(discussing._openFor({ subject: "p1" })).toEqual([]);
    const late = thrown(() =>
      discussing.respond({
        discussion: "discussion-1",
        author: "Sol",
        text: "Later",
        at: instant(5),
      }),
    );
    expect(late).toBeInstanceOf(DiscussionNotOpen);
    expect((late as Error).message).toBe("This discussion is not open.");
    expect(
      thrown(() => discussing.close({ discussion: "discussion-1", at: instant(5) })),
    ).toBeInstanceOf(DiscussionNotOpen);

    expect(discussing.open({ subject: "p1", at: instant(6) })).toEqual({
      discussion: "discussion-2",
    });
    expect(discussing._responses({ discussion: "discussion-1" })).toEqual([
      {
        response: "response-1",
        author: "Sol",
        text: "Proceed in two stages.",
        addedAt: instant(3),
      },
    ]);
    expect(discussing._response({ response: "missing" })).toEqual([]);
  });

  test("orders responses by time and then identity", () => {
    const ids = ["discussion", "response-z", "response-b", "response-a"];
    const discussing = new DiscussingMemoryConcept(() => ids.shift() ?? "unexpected");
    discussing.open({ subject: "p1", at: instant(0) });
    discussing.respond({ discussion: "discussion", author: "A", text: "third", at: instant(2) });
    discussing.respond({ discussion: "discussion", author: "B", text: "first", at: instant(1) });
    discussing.respond({ discussion: "discussion", author: "C", text: "second", at: instant(2) });

    expect(
      discussing._responses({ discussion: "discussion" }).map(({ response }) => response),
    ).toEqual(["response-b", "response-a", "response-z"]);
    expect(discussing._responses({ discussion: "missing" })).toEqual([]);
  });

  test("serializes competing open, close, and response actions", async () => {
    const openIDs = ["discussion-a", "discussion-b"];
    const opening = new DiscussingMemoryConcept(() => openIDs.shift() ?? "unexpected");
    const opens = await Promise.allSettled([
      Promise.resolve().then(() => opening.open({ subject: "p1", at: instant(0) })),
      Promise.resolve().then(() => opening.open({ subject: "p1", at: instant(0) })),
    ]);
    expect(opens.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(rejected(opens)[0]).toBeInstanceOf(DiscussionAlreadyOpen);

    const ids = ["discussion", "response"];
    const discussing = new DiscussingMemoryConcept(() => ids.shift() ?? "unexpected");
    discussing.open({ subject: "atomic", at: instant(0) });
    const respondAndClose = await Promise.allSettled([
      Promise.resolve().then(() =>
        discussing.respond({
          discussion: "discussion",
          author: "Sol",
          text: "Response",
          at: instant(1),
        }),
      ),
      Promise.resolve().then(() => discussing.close({ discussion: "discussion", at: instant(2) })),
    ]);
    expect(respondAndClose.every(({ status }) => status === "fulfilled")).toBe(true);
    expect(discussing._responses({ discussion: "discussion" })).toHaveLength(1);

    const closing = new DiscussingMemoryConcept(() => "close-discussion");
    closing.open({ subject: "closing", at: instant(0) });
    const closes = await Promise.allSettled([
      Promise.resolve().then(() =>
        closing.close({ discussion: "close-discussion", at: instant(3) }),
      ),
      Promise.resolve().then(() =>
        closing.close({ discussion: "close-discussion", at: instant(3) }),
      ),
    ]);
    expect(closes.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(rejected(closes)).toHaveLength(1);
    expect(rejected(closes)[0]).toBeInstanceOf(DiscussionNotOpen);
  });
});
