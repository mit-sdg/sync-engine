import { MongoMemoryServer } from "mongodb-memory-server";

export default async function setup(): Promise<() => Promise<void>> {
  if (process.env.CATALOG_MONGO !== "1" || process.env.CATALOG_SKIP_MONGO === "1")
    return async () => {};
  const server = await MongoMemoryServer.create();
  process.env.MONGODB_URI = server.getUri();
  return async () => {
    await server.stop();
  };
}
