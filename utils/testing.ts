import { type Db, MongoClient } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";

/** A connected in-memory MongoDB handle plus its teardown. */
export interface TestMongo {
  db: Db;
  client: MongoClient;
  stop: () => Promise<void>;
}

let _sharedServer: MongoMemoryServer | undefined;
let _sharedClient: MongoClient | undefined;
let _refs = 0;
let _boot: Promise<void> | undefined;

/**
 * Starts an in-memory MongoDB and returns a connected database.
 * Reuses a single mongod process across all test files for speed.
 * Each test file is responsible for per-collection cleanup via beforeEach.
 *
 * App-agnostic: depends only on `mongodb` and `mongodb-memory-server`.
 */
export async function setupTestDb(dbName = "test"): Promise<TestMongo> {
  if (_refs === 0) {
    _boot = (async () => {
      _sharedServer = await MongoMemoryServer.create();
      _sharedClient = new MongoClient(_sharedServer.getUri());
      _sharedClient.on("error", () => {});
      await _sharedClient.connect();
    })();
  }
  _refs++;
  await _boot;

  const client = _sharedClient;
  if (!client) throw new Error("MongoDB not initialized");

  return {
    db: client.db(dbName),
    client,
    stop: async () => {
      _refs--;
      if (_refs === 0) {
        client.on("error", () => {});
        try {
          await client.close();
        } catch {
          /* expected */
        }
        await _sharedServer?.stop();
        _sharedClient = undefined;
        _sharedServer = undefined;
        _boot = undefined;
      }
    },
  };
}
