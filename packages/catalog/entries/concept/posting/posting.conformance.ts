import { describe, expect, test } from "vite-plus/test";
import {
  INVALID_POST_CONTENT_MESSAGE,
  InvalidPostContent,
  type PostRecord,
} from "./posting.shared.ts";

type Awaitable<T> = T | Promise<T>;

type PostDetails = Omit<PostRecord, "post">;
type AuthorPost = Omit<PostRecord, "author">;

export interface PostingBehavior {
  publish(input: { author: string; content: string; at: Date }): Awaitable<{ post: string }>;
  _all(input: Record<string, never>): Awaitable<PostRecord[]>;
  _get(input: { post: string }): Awaitable<PostDetails[]>;
  _byAuthor(input: { author: string }): Awaitable<AuthorPost[]>;
}

export interface PostingHarness {
  concept: PostingBehavior;
  close(): Awaitable<void>;
}

export type PostingHarnessFactory = (identities: readonly string[]) => Awaitable<PostingHarness>;

type Outcome<T> = { returned: true; value: T } | { returned: false; error: unknown };

async function capture<T>(operation: () => Awaitable<T>): Promise<Outcome<T>> {
  try {
    return { returned: true, value: await operation() };
  } catch (error) {
    return { returned: false, error };
  }
}

async function withPosting(
  create: PostingHarnessFactory,
  identities: readonly string[],
  run: (concept: PostingBehavior) => Promise<void>,
): Promise<void> {
  const harness = await create(identities);
  try {
    await run(harness.concept);
  } finally {
    await harness.close();
  }
}

export function postingConformance(
  floor: string,
  create: PostingHarnessFactory,
  skip = false,
): void {
  describe(`Posting ${floor}`, () => {
    test.skipIf(skip)("follows its principle and complete refusal contract", async () => {
      await withPosting(create, ["post-1", "post-2", "post-3"], async (posting) => {
        const firstAt = new Date("2026-08-10T10:00:00.000Z");
        const secondAt = new Date("2026-08-10T10:01:00.000Z");
        expect(
          await posting.publish({ author: "Ari", content: "First post", at: firstAt }),
        ).toEqual({ post: "post-1" });
        expect(
          await posting.publish({ author: "Bo", content: "Second post", at: secondAt }),
        ).toEqual({ post: "post-2" });

        expect(await posting._all({})).toEqual([
          {
            post: "post-1",
            author: "Ari",
            content: "First post",
            publishedAt: firstAt,
          },
          {
            post: "post-2",
            author: "Bo",
            content: "Second post",
            publishedAt: secondAt,
          },
        ]);
        expect(await posting._get({ post: "post-1" })).toEqual([
          { author: "Ari", content: "First post", publishedAt: firstAt },
        ]);
        expect(await posting._get({ post: "missing" })).toEqual([]);
        expect(await posting._byAuthor({ author: "Ari" })).toEqual([
          { post: "post-1", content: "First post", publishedAt: firstAt },
        ]);
        expect(await posting._byAuthor({ author: "Cy" })).toEqual([]);

        for (const content of [" \n\t", "x".repeat(501)]) {
          const refused = await capture(() =>
            posting.publish({ author: "Ari", content, at: secondAt }),
          );
          if (refused.returned) throw new Error("Posting accepted invalid content.");
          expect(refused.error).toBeInstanceOf(InvalidPostContent);
          expect((refused.error as Error).message).toBe(INVALID_POST_CONTENT_MESSAGE);
        }
        expect(await posting._all({})).toHaveLength(2);

        const boundary = "x".repeat(500);
        expect(await posting.publish({ author: "Ari", content: boundary, at: secondAt })).toEqual({
          post: "post-3",
        });
        expect(await posting._get({ post: "post-3" })).toEqual([
          { author: "Ari", content: boundary, publishedAt: secondAt },
        ]);
      });
    });

    test.skipIf(skip)("orders equal instants by Post identity", async () => {
      await withPosting(create, ["post-z", "post-a"], async (posting) => {
        const at = new Date("2026-08-10T11:00:00.000Z");
        await posting.publish({ author: "Ari", content: "Published first", at });
        await posting.publish({ author: "Ari", content: "Published second", at });
        expect((await posting._all({})).map(({ post }) => post)).toEqual(["post-a", "post-z"]);
        expect((await posting._byAuthor({ author: "Ari" })).map(({ post }) => post)).toEqual([
          "post-a",
          "post-z",
        ]);
      });
    });

    test.skipIf(skip)("retains explicit publication time and immutable Post state", async () => {
      await withPosting(create, ["post-1"], async (posting) => {
        const supplied = new Date("2026-08-10T12:00:00.000Z");
        const publishing = posting.publish({ author: "Ari", content: "Permanent", at: supplied });
        supplied.setUTCFullYear(2030);
        await publishing;

        const firstRead = await posting._get({ post: "post-1" });
        expect(firstRead[0]?.publishedAt).toEqual(new Date("2026-08-10T12:00:00.000Z"));
        firstRead[0]?.publishedAt.setUTCFullYear(2031);
        expect(await posting._get({ post: "post-1" })).toEqual([
          {
            author: "Ari",
            content: "Permanent",
            publishedAt: new Date("2026-08-10T12:00:00.000Z"),
          },
        ]);
      });
    });
  });
}
