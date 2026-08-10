import { MongoMemoryReplSet } from "mongodb-memory-server";

export default async function setup(): Promise<() => Promise<void>> {
  if (process.env.CATALOG_MONGO !== "1" || process.env.CATALOG_SKIP_MONGO === "1")
    return async () => {};
  const replicaSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
  });
  process.env.MONGODB_URI = replicaSet.getUri();
  return async () => {
    await replicaSet.stop();
  };
}
