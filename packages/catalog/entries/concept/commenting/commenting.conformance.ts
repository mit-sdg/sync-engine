import { describe, expect, test } from "vite-plus/test";
import {
  COMMENT_AUTHOR_MISMATCH_MESSAGE,
  COMMENT_NOT_FOUND_MESSAGE,
  CommentAuthorMismatch,
  CommentNotFound,
  INVALID_COMMENT_TEXT_MESSAGE,
  InvalidCommentText,
  type CommentRecord,
} from "./commenting.shared.ts";

type Awaitable<T> = T | Promise<T>;
type TargetComment = Omit<CommentRecord, "target">;
type CommentDetails = Omit<CommentRecord, "comment">;

export interface CommentingBehavior {
  add(input: {
    target: string;
    author: string;
    text: string;
    at: Date;
  }): Awaitable<{ comment: string }>;
  retract(input: { comment: string; author: string }): Awaitable<{ comment: string }>;
  _for(input: { target: string }): Awaitable<TargetComment[]>;
  _get(input: { comment: string }): Awaitable<CommentDetails[]>;
}

export interface CommentingHarness {
  concept: CommentingBehavior;
  close(): Awaitable<void>;
}

export type CommentingHarnessFactory = (
  identities: readonly string[],
) => Awaitable<CommentingHarness>;

type Outcome<T> = { returned: true; value: T } | { returned: false; error: unknown };

async function capture<T>(operation: () => Awaitable<T>): Promise<Outcome<T>> {
  try {
    return { returned: true, value: await operation() };
  } catch (error) {
    return { returned: false, error };
  }
}

async function withCommenting(
  create: CommentingHarnessFactory,
  identities: readonly string[],
  run: (concept: CommentingBehavior) => Promise<void>,
): Promise<void> {
  const harness = await create(identities);
  try {
    await run(harness.concept);
  } finally {
    await harness.close();
  }
}

function expectRefusal(
  outcome: Outcome<unknown>,
  refusal: new (...args: never[]) => Error,
  message: string,
): void {
  if (outcome.returned) throw new Error("Commenting returned instead of refusing.");
  expect(outcome.error).toBeInstanceOf(refusal);
  expect((outcome.error as Error).message).toBe(message);
}

export function commentingConformance(
  floor: string,
  create: CommentingHarnessFactory,
  skip = false,
): void {
  describe(`Commenting ${floor}`, () => {
    test.skipIf(skip)("follows its principle and complete refusal contract", async () => {
      await withCommenting(create, ["comment-1", "comment-2", "comment-3"], async (commenting) => {
        const firstAt = new Date("2026-08-10T10:00:00.000Z");
        const secondAt = new Date("2026-08-10T10:01:00.000Z");
        expect(
          await commenting.add({
            target: "topic-7",
            author: "Ari",
            text: "First reply",
            at: firstAt,
          }),
        ).toEqual({ comment: "comment-1" });
        expect(
          await commenting.add({
            target: "topic-7",
            author: "Bo",
            text: "Second reply",
            at: secondAt,
          }),
        ).toEqual({ comment: "comment-2" });
        expect(await commenting._for({ target: "topic-7" })).toEqual([
          { comment: "comment-1", author: "Ari", text: "First reply", addedAt: firstAt },
          { comment: "comment-2", author: "Bo", text: "Second reply", addedAt: secondAt },
        ]);
        expect(await commenting._for({ target: "unknown" })).toEqual([]);
        expect(await commenting._get({ comment: "comment-1" })).toEqual([
          { target: "topic-7", author: "Ari", text: "First reply", addedAt: firstAt },
        ]);
        expect(await commenting._get({ comment: "unknown" })).toEqual([]);

        expectRefusal(
          await capture(() => commenting.retract({ comment: "comment-1", author: "Bo" })),
          CommentAuthorMismatch,
          COMMENT_AUTHOR_MISMATCH_MESSAGE,
        );
        expect(await commenting._get({ comment: "comment-1" })).toHaveLength(1);
        expect(await commenting.retract({ comment: "comment-1", author: "Ari" })).toEqual({
          comment: "comment-1",
        });
        expectRefusal(
          await capture(() => commenting.retract({ comment: "comment-1", author: "Ari" })),
          CommentNotFound,
          COMMENT_NOT_FOUND_MESSAGE,
        );
        expect(await commenting._for({ target: "topic-7" })).toEqual([
          { comment: "comment-2", author: "Bo", text: "Second reply", addedAt: secondAt },
        ]);

        for (const text of [" \n\t", "x".repeat(1001)]) {
          expectRefusal(
            await capture(() =>
              commenting.add({ target: "topic-7", author: "Ari", text, at: secondAt }),
            ),
            InvalidCommentText,
            INVALID_COMMENT_TEXT_MESSAGE,
          );
        }
        expect(await commenting._for({ target: "topic-7" })).toHaveLength(1);

        const boundary = "x".repeat(1000);
        expect(
          await commenting.add({
            target: "topic-7",
            author: "Ari",
            text: boundary,
            at: secondAt,
          }),
        ).toEqual({ comment: "comment-3" });
      });
    });

    test.skipIf(skip)("orders equal instants by Comment identity", async () => {
      await withCommenting(create, ["comment-z", "comment-a"], async (commenting) => {
        const at = new Date("2026-08-10T11:00:00.000Z");
        await commenting.add({ target: "topic-7", author: "Ari", text: "First", at });
        await commenting.add({ target: "topic-7", author: "Bo", text: "Second", at });
        expect(
          (await commenting._for({ target: "topic-7" })).map(({ comment }) => comment),
        ).toEqual(["comment-a", "comment-z"]);
      });
    });

    test.skipIf(skip)("retains explicit addition time independently of caller values", async () => {
      await withCommenting(create, ["comment-1"], async (commenting) => {
        const supplied = new Date("2026-08-10T12:00:00.000Z");
        const adding = commenting.add({
          target: "topic-7",
          author: "Ari",
          text: "Reply",
          at: supplied,
        });
        supplied.setUTCFullYear(2030);
        await adding;
        const firstRead = await commenting._get({ comment: "comment-1" });
        expect(firstRead[0]?.addedAt).toEqual(new Date("2026-08-10T12:00:00.000Z"));
        firstRead[0]?.addedAt.setUTCFullYear(2031);
        expect((await commenting._get({ comment: "comment-1" }))[0]?.addedAt).toEqual(
          new Date("2026-08-10T12:00:00.000Z"),
        );
      });
    });

    test.skipIf(skip)("conditionally permits only one concurrent retraction", async () => {
      await withCommenting(create, ["comment-1"], async (commenting) => {
        await commenting.add({
          target: "topic-7",
          author: "Ari",
          text: "Reply",
          at: new Date("2026-08-10T13:00:00.000Z"),
        });
        const outcomes = await Promise.all([
          capture(() => commenting.retract({ comment: "comment-1", author: "Ari" })),
          capture(() => commenting.retract({ comment: "comment-1", author: "Ari" })),
        ]);
        expect(outcomes.filter(({ returned }) => returned)).toHaveLength(1);
        const refusal = outcomes.find(({ returned }) => !returned);
        if (refusal === undefined || refusal.returned) {
          throw new Error("Both concurrent retractions returned.");
        }
        expect(refusal.error).toBeInstanceOf(CommentNotFound);
        expect(await commenting._get({ comment: "comment-1" })).toEqual([]);
      });
    });

    test.skipIf(skip)("never lets a racing wrong author remove the Comment", async () => {
      await withCommenting(create, ["comment-1"], async (commenting) => {
        await commenting.add({
          target: "topic-7",
          author: "Ari",
          text: "Reply",
          at: new Date("2026-08-10T14:00:00.000Z"),
        });
        const [wrongAuthor, author] = await Promise.all([
          capture(() => commenting.retract({ comment: "comment-1", author: "Bo" })),
          capture(() => commenting.retract({ comment: "comment-1", author: "Ari" })),
        ]);
        expect(author).toEqual({ returned: true, value: { comment: "comment-1" } });
        if (wrongAuthor.returned) throw new Error("A non-author retracted the Comment.");
        expect(
          wrongAuthor.error instanceof CommentAuthorMismatch ||
            wrongAuthor.error instanceof CommentNotFound,
        ).toBe(true);
        expect(await commenting._get({ comment: "comment-1" })).toEqual([]);
      });
    });
  });
}
