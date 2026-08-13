import { describe, expect, test } from "vite-plus/test";
import { exact, object, stringArray, stringRecord } from "../src/decode.ts";

describe("catalog manifest decoders", () => {
  test("accepts exact records and valid string collections", () => {
    const value = object({ name: "entry" }, "entry");
    expect(value).toEqual({ name: "entry" });
    expect(() => exact(value, ["name"], "entry")).not.toThrow();
    expect(stringArray(["a", "b"], "items", true)).toEqual(["a", "b"]);
    expect(stringRecord({ package: "1.0.0" }, "packages")).toEqual({ package: "1.0.0" });
    expect(stringRecord(undefined, "packages", true)).toEqual({});
  });

  test.each([[null], [[]], ["record"]])("rejects a non-record %j", (value) => {
    expect(() => object(value, "entry")).toThrow("entry must be an object");
  });

  test("rejects unknown record fields", () => {
    expect(() => exact({ extra: true }, ["name"], "entry")).toThrow(
      "entry has unknown field extra",
    );
  });

  test.each([
    [undefined, false],
    ["items", false],
    [[""], false],
    [[1], false],
    [["same", "same"], true],
  ])("rejects an invalid string array %j", (value, unique) => {
    expect(() => stringArray(value, "items", unique)).toThrow();
  });

  test.each([[{ "": "value" }], [{ name: "" }], [{ name: 1 }]])(
    "rejects an invalid string record %j",
    (value) => {
      expect(() => stringRecord(value, "packages")).toThrow("packages contains an invalid value");
    },
  );
});
