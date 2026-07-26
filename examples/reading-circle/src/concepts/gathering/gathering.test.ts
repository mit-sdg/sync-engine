import { describe, expect, test } from "vite-plus/test";
import { identities as ids } from "../../support/identities.ts";
import { AlreadyJoined, GatheringNotFound, NotJoined } from "./errors.ts";
import { GatheringConcept } from "./gathering.ts";

describe("Gathering", () => {
  test("its principle: create, join once, leave once", () => {
    const gathering = new GatheringConcept(ids("workshop", "asha-membership", "bo-membership"));
    expect(gathering.create({ name: "Saturday Workshop", host: "Asha" })).toEqual({
      gathering: "workshop",
    });
    expect(gathering._get({ gathering: "workshop" })).toEqual([
      { gathering: "workshop", name: "Saturday Workshop", host: "Asha" },
    ]);
    expect(gathering._membership({ gathering: "workshop", member: "Asha" })).toEqual({
      joined: true,
    });
    expect(gathering.join({ gathering: "workshop", member: "Bo" })).toEqual({
      membership: "bo-membership",
    });
    const repeatedJoin = () => gathering.join({ gathering: "workshop", member: "Bo" });
    expect(repeatedJoin).toThrow(AlreadyJoined);
    expect(repeatedJoin).toThrow("This person already belongs to the gathering.");
    expect(gathering._members({ gathering: "workshop" })).toEqual([
      { member: "Asha" },
      { member: "Bo" },
    ]);
    expect(gathering.leave({ gathering: "workshop", member: "Bo" })).toEqual({
      membership: "bo-membership",
    });
    expect(gathering._membership({ gathering: "workshop", member: "Bo" })).toEqual({
      joined: false,
    });
    const repeatedLeave = () => gathering.leave({ gathering: "workshop", member: "Bo" });
    expect(repeatedLeave).toThrow(NotJoined);
    expect(repeatedLeave).toThrow("This person does not belong to the gathering.");
  });

  test("unknown gatherings refuse and membership always answers", () => {
    const gathering = new GatheringConcept(ids());
    const joinMissing = () => gathering.join({ gathering: "missing", member: "Bo" });
    expect(joinMissing).toThrow(GatheringNotFound);
    expect(joinMissing).toThrow("There is no such gathering.");
    const leaveMissing = () => gathering.leave({ gathering: "missing", member: "Bo" });
    expect(leaveMissing).toThrow(GatheringNotFound);
    expect(leaveMissing).toThrow("There is no such gathering.");
    expect(gathering._membership({ gathering: "missing", member: "Bo" })).toEqual({
      joined: false,
    });
  });
});
