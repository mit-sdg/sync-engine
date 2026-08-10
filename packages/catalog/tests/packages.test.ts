import { describe, expect, test } from "vite-plus/test";
import { installCommand, verifyPackages } from "../src/packages.ts";

describe("catalog package requirements", () => {
  test("accepts exact versions and subset ranges", () => {
    expect(
      verifyPackages(
        { dependencies: { mongodb: "6.21.0", semver: "^7.7.3" } },
        { mongodb: "^6.20.0", semver: ">=7 <8" },
      ),
    ).toEqual([]);
  });
  test("rejects overlap that is not a subset", () => {
    expect(verifyPackages({ dependencies: { mongodb: ">=6 <8" } }, { mongodb: ">=6 <7" })).toEqual([
      { name: "mongodb", required: ">=6 <7", actual: ">=6 <8" },
    ]);
  });
  test("reports non-semver project declarations as incompatible", () => {
    expect(verifyPackages({ dependencies: { mongodb: "workspace:*" } }, { mongodb: "^6" })).toEqual(
      [{ name: "mongodb", required: "^6", actual: "workspace:*" }],
    );
  });
  test("rejects an invalid catalog requirement", () => {
    expect(() => verifyPackages({}, { mongodb: "not-semver" })).toThrow("semantic-version");
  });
  test("rejects conflicting declarations", () => {
    expect(() =>
      verifyPackages(
        { dependencies: { mongodb: "6.21.0" }, devDependencies: { mongodb: "^6.20.0" } },
        { mongodb: "^6.20.0" },
      ),
    ).toThrow("conflicting");
  });
  test("formats one deterministic command", () => {
    expect(installCommand([{ name: "mongodb", required: "^6.20.0" }])).toBe(
      "bun add --exact mongodb@^6.20.0",
    );
  });
});
