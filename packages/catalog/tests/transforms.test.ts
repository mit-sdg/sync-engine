import { describe, expect, test } from "vite-plus/test";
import { renderFloor, transformConceptSpecifier } from "../src/transforms.ts";

describe("catalog transforms", () => {
  test("rewrites recipe vocabulary and test registrations relative to each destination", () => {
    expect(
      transformConceptSpecifier(
        'import { concepts } from "@catalog/concepts";\n' +
          'import { catalogRegistrations } from "@catalog/registrations";\n',
        "src/composition/recipe.test.ts",
      ),
    ).toBe(
      'import { concepts } from "../concept-set.ts";\n' +
        'import { catalogRegistrations } from "../catalog/registrations.generated.ts";\n',
    );
  });
  test("prunes unselected floors and chooses the class", () => {
    const source = `//#floor memory\nimport { Memory } from "./memory.ts";\n//#endfloor\n//#floor mongo\nimport { Mongo } from "./mongo.ts";\n//#endfloor\n//#class memory Memory\n//#class mongo Mongo\nconst value = {\n  class: Memory, // selected-class\n};\n`;
    expect(renderFloor(source, "mongo", ["memory", "mongo"])).toBe(
      'import { Mongo } from "./mongo.ts";\nconst value = {\n  class: Mongo,\n};\n',
    );
  });

  test.each([
    [
      "unknown selection",
      "//#class memory Memory\nclass: Memory, // selected-class\n",
      "mongo",
      ["memory"],
    ],
    [
      "nested blocks",
      "//#floor memory\n//#floor memory\n//#endfloor\n//#endfloor\n",
      "memory",
      ["memory"],
    ],
    ["extra end", "//#endfloor\n", "memory", ["memory"]],
    ["unknown marker", "//#floor mongo\n//#endfloor\n", "memory", ["memory"]],
    [
      "duplicate class",
      "//#class memory Memory\n//#class memory Other\nclass: Memory, // selected-class\n",
      "memory",
      ["memory"],
    ],
    ["invalid syntax", "//#floor memory extra\n", "memory", ["memory"]],
    ["open block", "//#floor memory\n", "memory", ["memory"]],
    ["missing selected class", "//#class memory Memory\n", "memory", ["memory"]],
    [
      "malformed selected class",
      "//#class memory Memory\nconst value = Memory; // selected-class\n",
      "memory",
      ["memory"],
    ],
  ])("rejects %s", (_label, source, floor, floors) => {
    expect(() => renderFloor(source as string, floor as string, floors as string[])).toThrow();
  });
});
