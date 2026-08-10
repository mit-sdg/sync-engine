import { MongoClient } from "mongodb";
import { expect, test } from "vite-plus/test";
import { AlreadyJoined, NotJoined } from "./gathering.shared.ts";
import { GatheringMongoConcept } from "./gathering.mongo.ts";

const environment = (
  globalThis as unknown as { process: { env: Record<string, string | undefined> } }
).process.env;
const enabled = environment.MONGODB_URI !== undefined && environment.CATALOG_SKIP_MONGO !== "1";
test.skipIf(!enabled)("Gathering mongo principle", async () => {
  const client = new MongoClient(environment.MONGODB_URI ?? "");
  await client.connect();
  try {
    const db = client.db(`catalog_gathering_${crypto.randomUUID()}`);
    const ids = ["workshop", "host", "guest"];
    const gathering = new GatheringMongoConcept(db, () => ids.shift() ?? "unexpected");
    await gathering.create({ name: "Workshop", host: "Asha" });
    expect(await gathering._get({ gathering: "workshop" })).toEqual([
      { gathering: "workshop", name: "Workshop", host: "Asha" },
    ]);
    expect(await gathering._membership({ gathering: "workshop", member: "Asha" })).toEqual({
      joined: true,
    });
    await gathering.join({ gathering: "workshop", member: "Bo" });
    expect(await gathering._members({ gathering: "workshop" })).toEqual([
      { member: "Asha" },
      { member: "Bo" },
    ]);
    await expect(gathering.join({ gathering: "workshop", member: "Bo" })).rejects.toThrow(
      AlreadyJoined,
    );
    await gathering.leave({ gathering: "workshop", member: "Bo" });
    await expect(gathering.leave({ gathering: "workshop", member: "Bo" })).rejects.toThrow(
      NotJoined,
    );
    await expect(gathering.join({ gathering: "missing", member: "Bo" })).rejects.toThrow();
    await db.dropDatabase();
  } finally {
    await client.close();
  }
});
