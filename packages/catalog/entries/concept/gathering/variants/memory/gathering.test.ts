import { GatheringConcept, AlreadyJoined, GatheringNotFound, NotJoined } from "./gathering.ts";

const values = ["workshop", "asha-membership", "bo-membership"];
const gathering = new GatheringConcept(() => values.shift() ?? "unexpected");
const created = gathering.create({ name: "Saturday Workshop", host: "Asha" });
if (created.gathering !== "workshop") throw new Error("The gathering identity was not returned.");
gathering.join({ gathering: "workshop", member: "Bo" });
if (gathering._members({ gathering: "workshop" }).map(({ member }) => member).join(",") !== "Asha,Bo") {
  throw new Error("Membership did not retain join order.");
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
console.log("Gathering principle holds");
