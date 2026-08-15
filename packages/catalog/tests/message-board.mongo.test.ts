import { MongoClient } from "mongodb";
import { test, vi } from "vite-plus/test";
import { applicationConceptSet } from "../entries/_typecheck/concept-set.ts";
import {
  exerciseMessageBoard,
  exerciseMessageBoardSecurity,
  exerciseRegistrationPartialFailure,
  type CatalogInstances,
} from "../entries/recipe/message-board/message-board.behavior.ts";

const enabled = process.env.MONGODB_URI !== undefined && process.env.CATALOG_SKIP_MONGO !== "1";

async function withMongoFloor(run: (instances: CatalogInstances) => Promise<void>): Promise<void> {
  const client = new MongoClient(process.env.MONGODB_URI ?? "");
  await client.connect();
  const db = client.db(`message_board_${crypto.randomUUID()}`);
  try {
    const instances = applicationConceptSet.implementations("mongo", { db });
    await run(instances);
  } finally {
    try {
      await db.dropDatabase();
    } finally {
      await client.close();
    }
  }
}

test.skipIf(!enabled)("Message Board runs against the real Mongo floor", async () => {
  await withMongoFloor(exerciseMessageBoard);
});

test.skipIf(!enabled)(
  "Message Board retains registration after a Mongo session fault",
  async () => {
    const reported = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await withMongoFloor(exerciseRegistrationPartialFailure);
    } finally {
      reported.mockRestore();
    }
  },
);

test.skipIf(!enabled)("Message Board Mongo routes enforce Session-bound authority", async () => {
  await withMongoFloor(exerciseMessageBoardSecurity);
});
