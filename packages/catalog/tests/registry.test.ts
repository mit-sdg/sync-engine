import { describe, expect, test } from "vite-plus/test";
import { CatalogRegistry } from "../src/registry.ts";

describe("catalog registry", () => {
  test("loads the curated index and exposes plain asset selectors", async () => {
    const registry = await CatalogRegistry.load();
    expect([...registry.entries.keys()]).toHaveLength(24);
    const concept = registry.entries.get("concept/selecting");
    expect(concept?.kind).toBe("concept");
    if (concept?.kind !== "concept") throw new Error("missing selecting concept");
    expect(concept.design).toBe("spec.md");
    expect(CatalogRegistry.sources(concept).map(({ selector }) => selector)).toContain(
      "mongo/selecting.mongo.ts",
    );

    const recipe = registry.entries.get("recipe/workshop-selection");
    expect(recipe?.kind).toBe("recipe");
    if (recipe?.kind !== "recipe") throw new Error("missing workshop-selection recipe");
    expect(recipe.requires).toEqual(["concept/gathering", "concept/selecting"]);
    expect(CatalogRegistry.sources(recipe).map(({ selector }) => selector)).toContain(
      "workshop-selection.ts",
    );
  });
});
