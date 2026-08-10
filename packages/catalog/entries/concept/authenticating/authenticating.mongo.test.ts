import { MongoClient, type Db } from "mongodb";
import { describe, expect, test } from "vite-plus/test";
import {
  type AccountRecord,
  InvalidCredentials,
  INVALID_CREDENTIALS_DETAIL,
  UsernameTaken,
} from "./authenticating.shared.ts";
import { AuthenticatingMongoConcept, ensureAuthenticatingIndexes } from "./authenticating.mongo.ts";
import {
  CountdownLatch,
  DeterministicPasswordVerifier,
  saltSequence,
} from "./authenticating.test-support.ts";

const enabled = process.env.MONGODB_URI !== undefined && process.env.CATALOG_SKIP_MONGO !== "1";
const FIRST_PASSWORD = "correct horse";
const SECOND_PASSWORD = "different horse";

async function withDatabase(run: (db: Db) => Promise<void>): Promise<void> {
  const client = new MongoClient(process.env.MONGODB_URI ?? "");
  await client.connect();
  const db = client.db(`catalog_authenticating_${crypto.randomUUID()}`);
  try {
    await run(db);
  } finally {
    await db.dropDatabase();
    await client.close();
  }
}

function fixture(db: Db, salts = ["salt-000000000001", "salt-000000000002", "salt-000000000003"]) {
  const passwordVerifier = new DeterministicPasswordVerifier();
  const authenticating = new AuthenticatingMongoConcept(db, {
    passwordVerifier,
    freshSalt: saltSequence(salts),
  });
  return { authenticating, passwordVerifier };
}

describe.skipIf(!enabled)("Authenticating mongo", () => {
  test("its principle: register, authenticate, change the password, and unregister", async () => {
    await withDatabase(async (db) => {
      const { authenticating } = fixture(db);
      expect(await authenticating.register({ username: "ari", password: FIRST_PASSWORD })).toEqual({
        username: "ari",
      });
      expect(await authenticating._registered({ username: "ari" })).toEqual({
        registered: true,
      });

      await expect(
        authenticating.register({ username: "ari", password: SECOND_PASSWORD }),
      ).rejects.toThrow(UsernameTaken);
      await expect(
        authenticating.authenticate({ username: "ari", password: "incorrect password" }),
      ).rejects.toThrow(InvalidCredentials);
      expect(
        await authenticating.authenticate({ username: "ari", password: FIRST_PASSWORD }),
      ).toEqual({ username: "ari" });

      expect(
        await authenticating.changePassword({
          username: "ari",
          currentPassword: FIRST_PASSWORD,
          newPassword: SECOND_PASSWORD,
        }),
      ).toEqual({ username: "ari" });
      await expect(
        authenticating.authenticate({ username: "ari", password: FIRST_PASSWORD }),
      ).rejects.toThrow(InvalidCredentials);
      expect(
        await authenticating.authenticate({ username: "ari", password: SECOND_PASSWORD }),
      ).toEqual({ username: "ari" });

      expect(
        await authenticating.unregister({ username: "ari", password: SECOND_PASSWORD }),
      ).toEqual({ username: "ari" });
      expect(await authenticating._registered({ username: "ari" })).toEqual({
        registered: false,
      });
      await expect(
        authenticating.authenticate({ username: "ari", password: SECOND_PASSWORD }),
      ).rejects.toThrow(INVALID_CREDENTIALS_DETAIL);
    });
  });

  test("a unique index serializes concurrent registration", async () => {
    await withDatabase(async (db) => {
      await ensureAuthenticatingIndexes(db);
      const { authenticating, passwordVerifier } = fixture(db);
      let release = () => {};
      passwordVerifier.creationGate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const bothCreating = new CountdownLatch(2);
      passwordVerifier.creationStarted = () => bothCreating.arrive();
      const registrations = [
        authenticating.register({ username: "ari", password: FIRST_PASSWORD }),
        authenticating.register({ username: "ari", password: SECOND_PASSWORD }),
      ];
      await bothCreating.reached;
      release();

      const results = await Promise.allSettled(registrations);
      expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
      expect(results.filter(({ status }) => status === "rejected")).toHaveLength(1);
      const acceptedPassword =
        results[0]?.status === "fulfilled" ? FIRST_PASSWORD : SECOND_PASSWORD;
      expect(
        await authenticating.authenticate({ username: "ari", password: acceptedPassword }),
      ).toEqual({ username: "ari" });

      const indexes = await db.collection("authenticating_accounts").listIndexes().toArray();
      expect(indexes).toEqual(
        expect.arrayContaining([expect.objectContaining({ key: { username: 1 }, unique: true })]),
      );
    });
  });

  test("password replacement is conditional on the credential that was checked", async () => {
    await withDatabase(async (db) => {
      const { authenticating, passwordVerifier } = fixture(db);
      await authenticating.register({ username: "ari", password: FIRST_PASSWORD });

      let release = () => {};
      passwordVerifier.verificationGate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const bothVerifying = new CountdownLatch(2);
      passwordVerifier.verificationStarted = () => bothVerifying.arrive();
      const changes = [
        authenticating.changePassword({
          username: "ari",
          currentPassword: FIRST_PASSWORD,
          newPassword: SECOND_PASSWORD,
        }),
        authenticating.changePassword({
          username: "ari",
          currentPassword: FIRST_PASSWORD,
          newPassword: "third password",
        }),
      ];
      await bothVerifying.reached;
      release();

      const results = await Promise.allSettled(changes);
      expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
      const failed = results.find(({ status }) => status === "rejected");
      expect(failed).toMatchObject({ status: "rejected", reason: expect.any(InvalidCredentials) });
      const acceptedPassword =
        results[0]?.status === "fulfilled" ? SECOND_PASSWORD : "third password";
      expect(
        await authenticating.authenticate({ username: "ari", password: acceptedPassword }),
      ).toEqual({ username: "ari" });
      await expect(
        authenticating.authenticate({ username: "ari", password: FIRST_PASSWORD }),
      ).rejects.toThrow(InvalidCredentials);
    });
  });

  test("successful authentication upgrades an old stored verifier", async () => {
    await withDatabase(async (db) => {
      const { authenticating, passwordVerifier } = fixture(db);
      await authenticating.register({ username: "ari", password: FIRST_PASSWORD });
      passwordVerifier.profile = "test-v2";

      expect(
        await authenticating.authenticate({ username: "ari", password: FIRST_PASSWORD }),
      ).toEqual({ username: "ari" });
      const upgraded = await db
        .collection<AccountRecord>("authenticating_accounts")
        .findOne({ username: "ari" });
      expect(upgraded).toMatchObject({
        salt: "salt-000000000002",
        passwordVerifier: expect.stringMatching(/^test-v2\./),
      });
      await authenticating.authenticate({ username: "ari", password: FIRST_PASSWORD });
      expect(passwordVerifier.createdSalts).toHaveLength(2);
    });
  });

  test("unknown usernames use the dummy path and stored records contain no password", async () => {
    await withDatabase(async (db) => {
      const salt = Buffer.alloc(16, 7).toString("base64url");
      const authenticating = new AuthenticatingMongoConcept(db, { freshSalt: () => salt });
      const output = await authenticating.register({ username: "ari", password: FIRST_PASSWORD });
      expect(output).toEqual({ username: "ari" });
      const stored = await db.collection<AccountRecord>("authenticating_accounts").findOne({});
      expect(stored?.passwordVerifier).toMatch(/^\$argon2id\$/);
      expect(JSON.stringify(stored)).not.toContain(FIRST_PASSWORD);

      await expect(
        authenticating.authenticate({ username: "unknown", password: "incorrect password" }),
      ).rejects.toThrow(InvalidCredentials);
      expect(await authenticating._registered({ username: "unknown" })).toEqual({
        registered: false,
      });
    });
  });
});
