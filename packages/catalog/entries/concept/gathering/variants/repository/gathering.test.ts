import {
  GatheringConcept,
  AlreadyJoined,
  GatheringNotFound,
  NotJoined,
  type Gathering,
  type GatheringRepository,
  type Membership,
} from "./gathering.ts";

class MemoryRepository implements GatheringRepository {
  readonly gatherings = new Map<string, Gathering>();
  readonly membershipEntries = new Map<string, Membership>();
  gathering(id: string) {
    return this.gatherings.get(id);
  }
  saveGathering(gathering: Gathering) {
    this.gatherings.set(gathering.gathering, gathering);
  }
  membership(gathering: string, member: string) {
    return [...this.membershipEntries.values()].find(
      (entry) => entry.gathering === gathering && entry.member === member,
    );
  }
  memberships(gathering: string) {
    return [...this.membershipEntries.values()].filter((entry) => entry.gathering === gathering);
  }
  saveMembership(membership: Membership) {
    this.membershipEntries.set(membership.membership, membership);
  }
  deleteMembership(membership: string) {
    this.membershipEntries.delete(membership);
  }
}

const values = ["workshop", "asha-membership", "bo-membership"];
const repository = new MemoryRepository();
const gathering = new GatheringConcept(repository, () => values.shift() ?? "unexpected");
gathering.create({ name: "Saturday Workshop", host: "Asha" });
gathering.join({ gathering: "workshop", member: "Bo" });
if (gathering._members({ gathering: "workshop" }).map(({ member }) => member).join(",") !== "Asha,Bo") {
  throw new Error("Repository membership did not retain insertion order.");
}
try {
  gathering.join({ gathering: "workshop", member: "Bo" });
  throw new Error("A duplicate membership was accepted.");
} catch (error) {
  if (!(error instanceof AlreadyJoined)) throw error;
}
gathering.leave({ gathering: "workshop", member: "Bo" });
try {
  gathering.leave({ gathering: "workshop", member: "Bo" });
  throw new Error("A missing membership left twice.");
} catch (error) {
  if (!(error instanceof NotJoined)) throw error;
}
try {
  gathering.join({ gathering: "missing", member: "Cy" });
  throw new Error("An unknown gathering accepted a member.");
} catch (error) {
  if (!(error instanceof GatheringNotFound)) throw error;
}
console.log("Gathering repository conformance holds");
