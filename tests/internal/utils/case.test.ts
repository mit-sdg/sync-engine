import { describe, expect, test } from "vite-plus/test";
import { heading } from "@engine/utils/case";

describe("case utilities", () => {
  test("heading returns the original string when there are no alphanumeric characters", () => {
    expect(heading("---")).toBe("---");
    expect(heading("   ")).toBe("   ");
  });
});
