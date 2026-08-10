import { MongoClient } from "mongodb";
import { expect, test } from "vite-plus/test";
import { NoCurrentSelection } from "./selecting.shared.ts";
import { SelectingMongoConcept } from "./selecting.mongo.ts";

const environment = (
  globalThis as unknown as { process: { env: Record<string, string | undefined> } }
).process.env;
const enabled = environment.MONGODB_URI !== undefined && environment.CATALOG_SKIP_MONGO !== "1";
test.skipIf(!enabled)("Selecting mongo principle", async () => {
  const client = new MongoClient(environment.MONGODB_URI ?? "");
  await client.connect();
  try {
    const db = client.db(`catalog_selecting_${crypto.randomUUID()}`);
    const selecting = new SelectingMongoConcept(db, () => "selection");
    const chosen = await selecting.choose({ scope: "workshop", item: "Essay" });
    expect(await selecting._get(chosen)).toEqual([
      { selection: "selection", scope: "workshop", item: "Essay" },
    ]);
    expect(await selecting._current({ scope: "workshop" })).toEqual([
      { selection: "selection", scope: "workshop", item: "Essay" },
    ]);
    await selecting.clear({ scope: "workshop" });
    await expect(selecting.clear({ scope: "workshop" })).rejects.toThrow(NoCurrentSelection);
    await db.dropDatabase();
  } finally {
    await client.close();
  }
});
