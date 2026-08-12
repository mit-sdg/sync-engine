import { describe, expect, test } from "vite-plus/test";
import {
  AuthenticatingConcept,
  InvalidCredentials,
  InvalidUsername,
  UsernameTaken,
  WeakPassword,
} from "../../src/concepts/Authenticating.ts";

describe("Authenticating", () => {
  test("its principle: register and prove a password without exposing its verifier", () => {
    const authenticating = new AuthenticatingConcept(() => "salt-1");
    expect(authenticating.register({ username: "ari", password: "correct horse" })).toEqual({
      username: "ari",
    });
    expect(authenticating._registered({ username: "ari" })).toEqual({ registered: true });

    const duplicate = () =>
      authenticating.register({ username: "ari", password: "another password" });
    expect(duplicate).toThrow(UsernameTaken);
    expect(duplicate).toThrow("That username is already registered.");

    const wrong = () => authenticating.authenticate({ username: "ari", password: "wrong pass" });
    expect(wrong).toThrow(InvalidCredentials);
    expect(wrong).toThrow("The username or password is incorrect.");
    expect(authenticating.authenticate({ username: "ari", password: "correct horse" })).toEqual({
      username: "ari",
    });
  });

  test("malformed registration is refused without creating an account", () => {
    const authenticating = new AuthenticatingConcept();
    expect(() => authenticating.register({ username: "a!", password: "correct horse" })).toThrow(
      InvalidUsername,
    );
    expect(() => authenticating.register({ username: "ari", password: "short" })).toThrow(
      WeakPassword,
    );
    expect(authenticating._registered({ username: "ari" })).toEqual({ registered: false });
  });
});
