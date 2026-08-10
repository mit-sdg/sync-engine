import { describe, expect, test } from "vite-plus/test";
import {
  InvalidCredentials,
  INVALID_CREDENTIALS_DETAIL,
  InvalidUsername,
  UsernameTaken,
  WeakPassword,
} from "./authenticating.shared.ts";
import { AuthenticatingMemoryConcept } from "./authenticating.memory.ts";
import {
  CountdownLatch,
  DeterministicPasswordVerifier,
  saltSequence,
} from "./authenticating.test-support.ts";

const FIRST_PASSWORD = "correct horse";
const SECOND_PASSWORD = "different horse";

function fixture(salts = ["salt-000000000001", "salt-000000000002", "salt-000000000003"]) {
  const passwordVerifier = new DeterministicPasswordVerifier();
  const authenticating = new AuthenticatingMemoryConcept({
    passwordVerifier,
    freshSalt: saltSequence(salts),
  });
  return { authenticating, passwordVerifier };
}

describe("Authenticating memory", () => {
  test("its principle: register, authenticate, change the password, and unregister", async () => {
    const { authenticating } = fixture();
    expect(await authenticating.register({ username: "ari", password: FIRST_PASSWORD })).toEqual({
      username: "ari",
    });
    expect(authenticating._registered({ username: "ari" })).toEqual({ registered: true });

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

    expect(await authenticating.unregister({ username: "ari", password: SECOND_PASSWORD })).toEqual(
      { username: "ari" },
    );
    expect(authenticating._registered({ username: "ari" })).toEqual({ registered: false });
    await expect(
      authenticating.authenticate({ username: "ari", password: SECOND_PASSWORD }),
    ).rejects.toThrow(InvalidCredentials);
  });

  test("registration and password-change validation leave account state unchanged", async () => {
    const { authenticating } = fixture();
    for (const username of ["ab", "a".repeat(33), "a.b", "arí"]) {
      await expect(authenticating.register({ username, password: FIRST_PASSWORD })).rejects.toThrow(
        InvalidUsername,
      );
      expect(authenticating._registered({ username })).toEqual({ registered: false });
    }
    for (const password of ["x".repeat(7), "x".repeat(129)]) {
      await expect(authenticating.register({ username: "ari", password })).rejects.toThrow(
        WeakPassword,
      );
      expect(authenticating._registered({ username: "ari" })).toEqual({ registered: false });
    }

    await authenticating.register({ username: "ari", password: FIRST_PASSWORD });
    await expect(
      authenticating.changePassword({
        username: "ari",
        currentPassword: "incorrect password",
        newPassword: "short",
      }),
    ).rejects.toThrow(WeakPassword);
    await expect(
      authenticating.changePassword({
        username: "ari",
        currentPassword: "incorrect password",
        newPassword: SECOND_PASSWORD,
      }),
    ).rejects.toThrow(InvalidCredentials);
    await expect(
      authenticating.unregister({ username: "ari", password: "incorrect password" }),
    ).rejects.toThrow(INVALID_CREDENTIALS_DETAIL);
    expect(
      await authenticating.authenticate({ username: "ari", password: FIRST_PASSWORD }),
    ).toEqual({ username: "ari" });
  });

  test("unknown usernames perform a verifier workload and impossible passwords stay bounded", async () => {
    const { authenticating, passwordVerifier } = fixture();
    await authenticating.register({ username: "ari", password: FIRST_PASSWORD });

    await expect(
      authenticating.authenticate({ username: "unknown", password: "incorrect password" }),
    ).rejects.toThrow(InvalidCredentials);
    await expect(
      authenticating.authenticate({ username: "ari", password: "incorrect password" }),
    ).rejects.toThrow(InvalidCredentials);
    await expect(
      authenticating.authenticate({ username: "ari", password: "x".repeat(10_000) }),
    ).rejects.toThrow(InvalidCredentials);
    expect(passwordVerifier.verificationKinds.slice(-3)).toEqual(["dummy", "account", "dummy"]);
  });

  test("successful authentication upgrades an old verifier with a conditional replacement", async () => {
    const { authenticating, passwordVerifier } = fixture();
    await authenticating.register({ username: "ari", password: FIRST_PASSWORD });
    passwordVerifier.profile = "test-v2";

    expect(
      await authenticating.authenticate({ username: "ari", password: FIRST_PASSWORD }),
    ).toEqual({ username: "ari" });
    expect(passwordVerifier.createdSalts).toEqual(["salt-000000000001", "salt-000000000002"]);
    expect(
      await authenticating.authenticate({ username: "ari", password: FIRST_PASSWORD }),
    ).toEqual({ username: "ari" });
    expect(passwordVerifier.createdSalts).toHaveLength(2);
  });

  test("concurrent registration cannot replace the first account", async () => {
    const { authenticating, passwordVerifier } = fixture();
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
    const rejected = results.find(({ status }) => status === "rejected");
    expect(rejected).toMatchObject({ status: "rejected", reason: expect.any(UsernameTaken) });
    const acceptedPassword = results[0]?.status === "fulfilled" ? FIRST_PASSWORD : SECOND_PASSWORD;
    expect(
      await authenticating.authenticate({ username: "ari", password: acceptedPassword }),
    ).toEqual({ username: "ari" });
  });
});
