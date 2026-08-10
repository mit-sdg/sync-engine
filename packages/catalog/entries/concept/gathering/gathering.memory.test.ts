import { expect, test } from "vite-plus/test";
import { AlreadyJoined, NotJoined } from "./gathering.shared.ts";
import { GatheringMemoryConcept } from "./gathering.memory.ts";

test("Gathering memory principle", () => {
  const ids = ["workshop", "host-membership", "guest-membership"];
  const gathering = new GatheringMemoryConcept(() => ids.shift() ?? "unexpected");
  expect(gathering.create({ name: "Workshop", host: "Asha" })).toEqual({ gathering: "workshop" });
  expect(gathering._get({ gathering: "workshop" })).toEqual([
    { gathering: "workshop", name: "Workshop", host: "Asha" },
  ]);
  expect(gathering.join({ gathering: "workshop", member: "Bo" })).toEqual({
    membership: "guest-membership",
  });
  expect(gathering._members({ gathering: "workshop" })).toEqual([
    { member: "Asha" },
    { member: "Bo" },
  ]);
  expect(gathering._membership({ gathering: "workshop", member: "Bo" })).toEqual({
    joined: true,
  });
  expect(() => gathering.join({ gathering: "workshop", member: "Bo" })).toThrow(AlreadyJoined);
  gathering.leave({ gathering: "workshop", member: "Bo" });
  expect(() => gathering.leave({ gathering: "workshop", member: "Bo" })).toThrow(NotJoined);
  expect(() => gathering.join({ gathering: "missing", member: "Bo" })).toThrow();
});
