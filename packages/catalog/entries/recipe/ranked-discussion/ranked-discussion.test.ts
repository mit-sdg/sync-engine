import { assemble } from "@mit-sdg/sync-engine/assembly";
import { describe, expect, test } from "vite-plus/test";
import { applicationConcepts, vocabulary } from "@catalog/concepts";
import {
  CloseRankedDiscussion,
  DownvoteResponse,
  GetRankedDiscussion,
  OpenRankedDiscussion,
  RespondToDiscussion,
  UnvoteResponse,
  UpvoteResponse,
} from "./ranked-discussion.ts";

type Floor = "memory" | "mongo";
type Instances = ReturnType<(typeof applicationConcepts)["implementations"]>;
interface MongoFloorLease {
  database: unknown;
  close(): Promise<void>;
}
const openMongoFloor = (
  globalThis as typeof globalThis & {
    __catalogMongoFloor?: () => Promise<MongoFloorLease>;
  }
).__catalogMongoFloor;
const implementations = applicationConcepts.implementations as unknown as (
  floor: Floor,
  context: object,
) => Instances;
const memoryFloorAvailable = (() => {
  try {
    implementations("memory", {});
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes('floor "memory" is missing')) return false;
    throw error;
  }
})();

async function withFloor(
  floor: Floor,
  run: (instances: Instances) => Promise<void>,
): Promise<void> {
  const lease = floor === "mongo" ? await openMongoFloor?.() : undefined;
  if (floor === "mongo" && lease === undefined) return;
  try {
    await run(implementations(floor, lease === undefined ? {} : { db: lease.database }));
  } finally {
    await lease?.close();
  }
}

function value(result: { ok: true; value: unknown } | { ok: false; error: unknown }) {
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value as Record<string, unknown>;
}

const composition = {
  CloseRankedDiscussion,
  DownvoteResponse,
  GetRankedDiscussion,
  OpenRankedDiscussion,
  RespondToDiscussion,
  UnvoteResponse,
  UpvoteResponse,
};

for (const floor of ["memory", "mongo"] as const) {
  describe(`Ranked Discussion ${floor} floor`, () => {
    test.skipIf(
      (floor === "memory" && !memoryFloorAvailable) ||
        (floor === "mongo" && openMongoFloor === undefined),
    )(
      "validates responses before voting and forms aggregate scores",
      async () => {
        await withFloor(floor, async (instances) => {
          const application = assemble({
            vocabulary,
            instances: instances as never,
            composition,
          });
          const opened = value(
            await application.invoker.invoke(
              "/ranked-discussions/open" as never,
              { subject: "proposal-7" } as never,
            ),
          );
          const discussion = String(opened.discussion);
          const added = value(
            await application.invoker.invoke(
              "/ranked-discussions/respond" as never,
              {
                discussion,
                author: "Mina",
                text: "Proceed in two stages.",
              } as never,
            ),
          );
          const response = String(added.response);

          await expect(
            application.invoker.invoke("/ranked-discussions/get" as never, { discussion } as never),
          ).resolves.toMatchObject({
            ok: true,
            value: {
              discussion,
              responses: [
                {
                  response,
                  author: "Mina",
                  text: "Proceed in two stages.",
                  score: 0,
                },
              ],
            },
          });

          for (const route of [
            "/ranked-discussions/upvote",
            "/ranked-discussions/downvote",
            "/ranked-discussions/unvote",
          ]) {
            await expect(
              application.invoker.invoke(
                route as never,
                { response: "missing-response", voter: "Ari" } as never,
              ),
            ).resolves.toEqual({
              ok: false,
              error: { kind: "domain", value: "RESPONSE_NOT_FOUND" },
            });
          }
          await expect(
            application.concepts.Upvoting._vote({
              item: "missing-response",
              voter: "Ari",
            }),
          ).resolves.toEqual([]);

          await expect(
            application.invoker.invoke(
              "/ranked-discussions/upvote" as never,
              { response, voter: "Ari" } as never,
            ),
          ).resolves.toMatchObject({ ok: true });
          await expect(
            application.invoker.invoke(
              "/ranked-discussions/downvote" as never,
              { response, voter: "Bo" } as never,
            ),
          ).resolves.toMatchObject({ ok: true });
          await expect(
            application.invoker.invoke(
              "/ranked-discussions/downvote" as never,
              { response, voter: "Ari" } as never,
            ),
          ).resolves.toMatchObject({ ok: true });
          await expect(
            application.invoker.invoke(
              "/ranked-discussions/unvote" as never,
              { response, voter: "Ari" } as never,
            ),
          ).resolves.toMatchObject({ ok: true });

          await expect(
            application.invoker.invoke(
              "/ranked-discussions/close" as never,
              { discussion } as never,
            ),
          ).resolves.toMatchObject({ ok: true });
          await expect(
            application.invoker.invoke(
              "/ranked-discussions/respond" as never,
              { discussion, author: "Sol", text: "Too late." } as never,
            ),
          ).resolves.toEqual({
            ok: false,
            error: { kind: "domain", value: "DISCUSSION_NOT_OPEN" },
          });
          await expect(
            application.invoker.invoke("/ranked-discussions/get" as never, { discussion } as never),
          ).resolves.toMatchObject({
            ok: true,
            value: {
              discussion,
              responses: [{ response, score: -1 }],
            },
          });
        });
      },
      20_000,
    );
  });
}
