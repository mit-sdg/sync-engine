import { describe, expect, test } from "vite-plus/test";
import { PASSWORD_SALT_BYTES, securePasswordSalt } from "./authenticating.shared.ts";
import { argon2idPasswordVerifier, CURRENT_ARGON2ID_POLICY } from "./authenticating.verifier.ts";

const PASSWORD = "correct horse battery staple";

describe("Authenticating Argon2id verifier", () => {
  test("derives a self-describing one-way verifier and checks it", async () => {
    const salt = Buffer.alloc(PASSWORD_SALT_BYTES, 7).toString("base64url");
    const passwordVerifier = await argon2idPasswordVerifier.create({ password: PASSWORD, salt });
    expect(passwordVerifier).toMatch(/^\$argon2id\$v=19\$m=\d+,t=\d+,p=\d+\$/);
    expect(passwordVerifier).not.toContain(PASSWORD);
    expect(
      await argon2idPasswordVerifier.verify({
        password: PASSWORD,
        credential: { salt, passwordVerifier },
      }),
    ).toBe(true);
    expect(
      await argon2idPasswordVerifier.verify({
        password: "incorrect password",
        credential: { salt, passwordVerifier },
      }),
    ).toBe(false);
    expect(argon2idPasswordVerifier.needsUpgrade(passwordVerifier)).toBe(false);
  });

  test("the current profile meets the catalog security floor without defining concept behavior", () => {
    expect(CURRENT_ARGON2ID_POLICY.memoryCost).toBeGreaterThanOrEqual(19 * 1024);
    expect(CURRENT_ARGON2ID_POLICY.timeCost).toBeGreaterThanOrEqual(2);
    expect(CURRENT_ARGON2ID_POLICY.outputLen).toBeGreaterThanOrEqual(32);
    expect(CURRENT_ARGON2ID_POLICY.saltBytes).toBeGreaterThanOrEqual(16);
    expect(
      argon2idPasswordVerifier.needsUpgrade(
        "$argon2id$v=19$m=4096,t=1,p=1$c2FsdC1zYWx0LXNhbHQ$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      ),
    ).toBe(true);
  });

  test("unknown and malformed records fail closed through a dummy verification", async () => {
    expect(
      await argon2idPasswordVerifier.verify({ password: PASSWORD, credential: undefined }),
    ).toBe(false);
    expect(
      await argon2idPasswordVerifier.verify({
        password: PASSWORD,
        credential: { salt: "c2FsdC1zYWx0LXNhbHQ", passwordVerifier: "not-a-verifier" },
      }),
    ).toBe(false);
  });

  test("the default salt source returns fresh 128-bit values", () => {
    const salts = Array.from({ length: 64 }, () => securePasswordSalt());
    expect(new Set(salts).size).toBe(salts.length);
    for (const salt of salts) {
      expect(salt).toMatch(/^[A-Za-z0-9_-]{22}$/);
      expect(Buffer.from(salt, "base64url")).toHaveLength(PASSWORD_SALT_BYTES);
    }
  });

  test("rejects an undersized injected salt", async () => {
    await expect(
      argon2idPasswordVerifier.create({
        password: PASSWORD,
        salt: Buffer.alloc(PASSWORD_SALT_BYTES - 1).toString("base64url"),
      }),
    ).rejects.toThrow("at least 16 bytes");
  });
});
