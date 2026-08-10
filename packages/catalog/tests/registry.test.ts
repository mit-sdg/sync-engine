import { describe, expect, test } from "vite-plus/test";
import { CatalogRegistry } from "../src/registry.ts";

describe("catalog registry", () => {
  test("loads entries and deduplicates recipe requirements", async () => {
    const registry = await CatalogRegistry.load();
    expect([...registry.entries.keys()]).toEqual([
      "concept/gathering",
      "concept/selecting",
      "concept/timing",
      "concept/upvoting",
      "concept/alerting",
      "concept/reserving",
      "concept/discussing",
      "concept/inviting",
      "concept/posting",
      "concept/commenting",
      "concept/labeling",
      "concept/trashing",
      "concept/approving",
      "concept/sessioning",
      "concept/authenticating",
      "recipe/workshop-selection",
      "recipe/member-reservations",
      "recipe/ranked-discussion",
      "recipe/invite-only-workshop",
      "recipe/incident-room",
      "recipe/recoverable-board",
    ]);
    expect(
      registry.resolve(["recipe/workshop-selection", "concept/gathering"]).map(({ id }) => id),
    ).toEqual(["concept/gathering", "concept/selecting", "recipe/workshop-selection"]);
    expect(registry.resolve(["recipe/incident-room"]).map(({ id }) => id)).toEqual([
      "concept/timing",
      "concept/gathering",
      "concept/selecting",
      "concept/discussing",
      "concept/alerting",
      "recipe/incident-room",
    ]);
    expect(registry.resolve(["recipe/recoverable-board"]).map(({ id }) => id)).toEqual([
      "concept/timing",
      "concept/posting",
      "concept/commenting",
      "concept/labeling",
      "concept/trashing",
      "recipe/recoverable-board",
    ]);
    expect(() => registry.resolve(["unknown"])).toThrow("unknown catalog entry");
  });
});
