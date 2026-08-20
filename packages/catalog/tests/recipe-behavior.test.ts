import { assemble } from "@mit-sdg/sync-engine/assembly";
import { describe, expect, test } from "vite-plus/test";
import { CommentingMemoryConcept } from "../entries/concept/commenting/commenting.memory.ts";
import { LabelingMemoryConcept } from "../entries/concept/labeling/labeling.memory.ts";
import { PostingMemoryConcept } from "../entries/concept/posting/posting.memory.ts";
import { TimingConcept } from "../entries/concept/timing/timing.ts";
import { TrashingMemoryConcept } from "../entries/concept/trashing/trashing.memory.ts";
import { applicationConceptSet } from "../entries/_typecheck/concept-set.ts";
import { compositions as boardCompositions } from "../entries/recipe/recoverable-board/recoverable-board.ts";

type Awaitable<T> = T | Promise<T>;

function identities(prefix: string): () => string {
  let next = 0;
  return () => `${prefix}-${String(++next)}`;
}

function clock(...instants: Date[]): { concept: TimingConcept; reads: () => number } {
  let index = 0;
  return {
    concept: new TimingConcept(() => {
      const instant = instants[Math.min(index, instants.length - 1)];
      index += 1;
      if (instant === undefined) throw new Error("The test clock has no instant.");
      return new Date(instant.getTime());
    }),
    reads: () => index,
  };
}

type BoardInstances = {
  Commenting: CommentingMemoryConcept;
  Labeling: LabelingMemoryConcept;
  Posting: PostingMemoryConcept;
  Timing: TimingConcept;
  Trashing: TrashingMemoryConcept;
};

async function boardFloor() {
  const testClock = clock(
    new Date("2026-08-10T11:00:00.000Z"),
    new Date("2026-08-10T11:01:00.000Z"),
    new Date("2026-08-10T11:02:00.000Z"),
    new Date("2026-08-10T11:03:00.000Z"),
    new Date("2026-08-10T11:04:00.000Z"),
  );
  const instances: BoardInstances = {
    Commenting: new CommentingMemoryConcept(identities("comment")),
    Labeling: new LabelingMemoryConcept(identities("label")),
    Posting: new PostingMemoryConcept(identities("post")),
    Timing: testClock.concept,
    Trashing: new TrashingMemoryConcept(),
  };
  return { instances, reads: testClock.reads, close: async () => {} };
}

const boardComposition = {
  ...boardCompositions.BoardContent,
  ...boardCompositions.BoardLabels,
  ...boardCompositions.PostRecovery,
  ...boardCompositions.BoardPages,
};

function boardApplication(instances: BoardInstances) {
  return assemble({
    conceptSet: applicationConceptSet,
    instances: instances as never,
    composition: boardComposition,
    queryCache: "none",
  });
}

async function rows<T>(value: Awaitable<T>): Promise<T> {
  return value;
}

for (const floor of ["memory"] as const) {
  describe(`Recoverable Board ${floor} floor`, () => {
    test("uses disposition-only visibility while retaining Posting and Commenting records", async () => {
      const fixture = await boardFloor();
      try {
        const application = boardApplication(fixture.instances);
        await expect(
          application.invoker.invoke("/recoverable-board/post", {
            author: "Ari",
            content: "Rollback completed",
          }),
        ).resolves.toEqual({ ok: true, value: { post: "post-1" } });
        await expect(
          application.invoker.invoke("/recoverable-board/comment", {
            post: "post-1",
            author: "Bo",
            text: "Latency is normal.",
          }),
        ).resolves.toEqual({ ok: true, value: { comment: "comment-1" } });
        await expect(
          application.invoker.invoke("/recoverable-board/create-label", { name: "resolved" }),
        ).resolves.toEqual({ ok: true, value: { label: "label-1" } });
        await expect(
          application.invoker.invoke("/recoverable-board/label", {
            post: "post-1",
            label: "label-1",
          }),
        ).resolves.toEqual({ ok: true, value: { post: "post-1", label: "label-1" } });

        const visible = {
          posts: [
            {
              post: "post-1",
              author: "Ari",
              content: "Rollback completed",
              publishedAt: new Date("2026-08-10T11:00:00.000Z"),
              comments: [
                {
                  comment: "comment-1",
                  author: "Bo",
                  text: "Latency is normal.",
                  addedAt: new Date("2026-08-10T11:01:00.000Z"),
                },
              ],
              labels: [{ label: "label-1", name: "resolved" }],
            },
          ],
        };
        await expect(application.invoker.invoke("/recoverable-board/list", {})).resolves.toEqual({
          ok: true,
          value: { board: visible },
        });

        await expect(
          application.invoker.invoke("/recoverable-board/trash", { post: "post-1" }),
        ).resolves.toEqual({ ok: true, value: { post: "post-1" } });
        await expect(application.invoker.invoke("/recoverable-board/list", {})).resolves.toEqual({
          ok: true,
          value: { board: { posts: [] } },
        });
        await expect(
          application.invoker.invoke("/recoverable-board/comment", {
            post: "post-1",
            author: "Cy",
            text: "Hidden comment",
          }),
        ).resolves.toEqual({
          ok: false,
          error: { kind: "domain", value: "POST_NOT_VISIBLE" },
        });
        expect(await rows(fixture.instances.Posting._get({ post: "post-1" }))).toHaveLength(1);
        expect(await rows(fixture.instances.Commenting._for({ target: "post-1" }))).toHaveLength(1);
        expect(
          await rows(
            fixture.instances.Labeling._for({ scope: "recoverable-board", item: "post-1" }),
          ),
        ).toEqual([{ label: "label-1", name: "resolved" }]);

        await expect(
          application.invoker.invoke("/recoverable-board/restore", { post: "post-1" }),
        ).resolves.toEqual({ ok: true, value: { post: "post-1" } });
        await expect(application.invoker.invoke("/recoverable-board/list", {})).resolves.toEqual({
          ok: true,
          value: { board: visible },
        });

        await application.invoker.invoke("/recoverable-board/trash", { post: "post-1" });
        await expect(
          application.invoker.invoke("/recoverable-board/purge", { post: "post-1" }),
        ).resolves.toEqual({ ok: true, value: { post: "post-1" } });
        await expect(application.invoker.invoke("/recoverable-board/list", {})).resolves.toEqual({
          ok: true,
          value: { board: { posts: [] } },
        });
        await expect(
          application.invoker.invoke("/recoverable-board/restore", { post: "post-1" }),
        ).resolves.toEqual({
          ok: false,
          error: { kind: "domain", value: "ITEM_PURGED" },
        });

        // Purge is a permanent visibility decision, not a physical erasure claim.
        expect(await rows(fixture.instances.Posting._get({ post: "post-1" }))).toHaveLength(1);
        expect(await rows(fixture.instances.Commenting._for({ target: "post-1" }))).toHaveLength(1);
        expect(
          await rows(
            fixture.instances.Labeling._for({ scope: "recoverable-board", item: "post-1" }),
          ),
        ).toEqual([{ label: "label-1", name: "resolved" }]);
        expect(await rows(fixture.instances.Trashing._state({ item: "post-1" }))).toEqual({
          status: "purged",
        });
        expect(fixture.reads()).toBe(5);
      } finally {
        await fixture.close();
      }
    });

    test("returns owner refusal codes without changing retained records", async () => {
      const fixture = await boardFloor();
      try {
        const application = boardApplication(fixture.instances);
        await expect(
          application.invoker.invoke("/recoverable-board/post", {
            author: "Ari",
            content: " ",
          }),
        ).resolves.toEqual({
          ok: false,
          error: { kind: "domain", value: "INVALID_POST_CONTENT" },
        });
        await application.invoker.invoke("/recoverable-board/post", {
          author: "Ari",
          content: "Post",
        });
        await expect(
          application.invoker.invoke("/recoverable-board/comment", {
            post: "post-1",
            author: "Ari",
            text: " ",
          }),
        ).resolves.toEqual({
          ok: false,
          error: { kind: "domain", value: "INVALID_COMMENT_TEXT" },
        });
        await application.invoker.invoke("/recoverable-board/comment", {
          post: "post-1",
          author: "Ari",
          text: "Comment",
        });
        await application.invoker.invoke("/recoverable-board/create-label", { name: "urgent" });
        await expect(
          application.invoker.invoke("/recoverable-board/create-label", { name: "urgent" }),
        ).resolves.toEqual({
          ok: false,
          error: { kind: "domain", value: "LABEL_NAME_TAKEN" },
        });
        await application.invoker.invoke("/recoverable-board/label", {
          post: "post-1",
          label: "label-1",
        });

        await expect(
          application.invoker.invoke("/recoverable-board/retract-comment", {
            comment: "comment-1",
            author: "Bo",
          }),
        ).resolves.toEqual({
          ok: false,
          error: { kind: "domain", value: "COMMENT_AUTHOR_MISMATCH" },
        });
        await expect(
          application.invoker.invoke("/recoverable-board/label", {
            post: "post-1",
            label: "label-1",
          }),
        ).resolves.toEqual({
          ok: false,
          error: { kind: "domain", value: "LABEL_ALREADY_APPLIED" },
        });
        await application.invoker.invoke("/recoverable-board/trash", { post: "post-1" });
        await expect(
          application.invoker.invoke("/recoverable-board/trash", { post: "post-1" }),
        ).resolves.toEqual({
          ok: false,
          error: { kind: "domain", value: "ITEM_ALREADY_TRASHED" },
        });
        await expect(
          application.invoker.invoke("/recoverable-board/unlabel", {
            post: "post-1",
            label: "label-1",
          }),
        ).resolves.toEqual({ ok: true, value: { post: "post-1", label: "label-1" } });
        await expect(
          application.invoker.invoke("/recoverable-board/unlabel", {
            post: "post-1",
            label: "label-1",
          }),
        ).resolves.toEqual({
          ok: false,
          error: { kind: "domain", value: "LABEL_NOT_APPLIED" },
        });
        expect(await rows(fixture.instances.Commenting._for({ target: "post-1" }))).toHaveLength(1);
      } finally {
        await fixture.close();
      }
    });
  });
}
