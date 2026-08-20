import { pluralize } from "../src/vendor/plur.ts";
import { describe, expect, test } from "vite-plus/test";

describe("vendored plur 6.0.0 pluralization", () => {
  test.each([
    ["item", "items"],
    ["party", "parties"],
    ["chaos", "chaoses"],
    ["advice", "advice"],
    ["cactus", "cactuses"],
    ["axis", "axes"],
    ["mouse", "mice"],
    ["person", "people"],
    ["Mouse", "Mice"],
    ["MOUSE", "MICE"],
  ])("pluralizes %s as %s", (singular, plural) => {
    expect(pluralize(singular)).toBe(plural);
  });
});
